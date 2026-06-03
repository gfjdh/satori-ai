package svc

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"syscall"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

var jobObject windows.Handle

func init() {
	h, err := windows.CreateJobObject(nil, nil)
	if err != nil {
		return
	}
	info := windows.JOBOBJECT_EXTENDED_LIMIT_INFORMATION{
		BasicLimitInformation: windows.JOBOBJECT_BASIC_LIMIT_INFORMATION{
			LimitFlags: windows.JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
		},
	}
	_, err = windows.SetInformationJobObject(
		h,
		windows.JobObjectExtendedLimitInformation,
		uintptr(unsafe.Pointer(&info)),
		uint32(unsafe.Sizeof(info)),
	)
	if err != nil {
		windows.CloseHandle(h)
		return
	}
	jobObject = h
}

func assignToJob(pid int) {
	if jobObject == 0 {
		return
	}
	h, err := windows.OpenProcess(windows.PROCESS_SET_QUOTA|windows.PROCESS_TERMINATE, false, uint32(pid))
	if err != nil {
		return
	}
	defer windows.CloseHandle(h)
	windows.AssignProcessToJobObject(jobObject, h)
}

func NewHiddenCommand(name string, arg ...string) *exec.Cmd {
	cmd := exec.Command(name, arg...)
	cmd.SysProcAttr = &syscall.SysProcAttr{
		HideWindow:    true,
		CreationFlags: 0x08000000, // CREATE_NO_WINDOW — prevents child process console windows
	}
	return cmd
}

func NewHiddenCommandTimeout(timeout time.Duration, name string, arg ...string) (*exec.Cmd, context.CancelFunc) {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	cmd := exec.CommandContext(ctx, name, arg...)
	cmd.SysProcAttr = &syscall.SysProcAttr{
		HideWindow:    true,
		CreationFlags: 0x08000000,
	}
	return cmd, cancel
}

// AssignCurrentToJob assigns the current process PID to the global Job Object.
func AssignCurrentToJob() {
	assignToJob(os.Getpid())
}

func NewNpmCommand(arg ...string) *exec.Cmd {
	cmd := NewHiddenCommand("npm", arg...)
	cmd.Env = os.Environ()
	cmd.Env = append(cmd.Env,
		"npm_config_sharp_binary_host=https://npmmirror.com/mirrors/sharp/",
		"npm_config_sharp_libvips_binary_host=https://npmmirror.com/mirrors/sharp-libvips/",
	)
	return cmd
}

func NewPipCommand(pipExe string, arg ...string) *exec.Cmd {
	cmd := NewHiddenCommand(pipExe, arg...)
	cmd.Env = os.Environ()
	cmd.Env = append(cmd.Env, "PIP_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple")
	return cmd
}

func NewPipCommandTimeout(timeout time.Duration, pipExe string, arg ...string) (*exec.Cmd, context.CancelFunc) {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	cmd := exec.CommandContext(ctx, pipExe, arg...)
	cmd.SysProcAttr = &syscall.SysProcAttr{
		HideWindow:    true,
		CreationFlags: 0x08000000,
	}
	cmd.Env = os.Environ()
	cmd.Env = append(cmd.Env, "PIP_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple")
	return cmd, cancel
}

// killPortOccupant finds and kills any process listening on the given TCP port.
func killPortOccupant(port int) error {
	// netstat -ano | findstr :<port>
	findCmd := exec.Command("cmd", "/c",
		fmt.Sprintf("netstat -ano | findstr :%d", port))
	findCmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000}
	out, err := findCmd.Output()
	if err != nil {
		return nil // no listener on port
	}
	for _, line := range strings.Split(string(out), "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) < 5 {
			continue
		}
		// look for LISTENING line
		if strings.Contains(line, "LISTENING") {
			pid := fields[len(fields)-1]
			if _, err := strconv.Atoi(pid); err != nil {
				continue
			}
			killCmd := exec.Command("taskkill", "/F", "/T", "/PID", pid)
			killCmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000}
			killCmd.Run()
		}
	}
	return nil
}

// CleanupOrphanPorts kills processes on all known service ports plus the launcher port.
func CleanupOrphanPorts() {
	knownPorts := []int{9527, 5030, 7860, 8742, 8743, 5032, 5173, 3682}
	for _, port := range knownPorts {
		killPortOccupant(port)
	}
}

// IsPortInUse returns true if a TCP listener exists on the given port.
func IsPortInUse(port int) bool {
	findCmd := exec.Command("cmd", "/c",
		fmt.Sprintf("netstat -ano | findstr :%d", port))
	findCmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000}
	out, err := findCmd.Output()
	if err != nil {
		return false
	}
	return strings.Contains(string(out), "LISTENING")
}
