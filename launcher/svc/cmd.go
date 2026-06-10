package svc

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"os/exec"
	"syscall"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

var (
	jobObject       windows.Handle
	jobObjectFailed bool
)

func init() {
	h, err := windows.CreateJobObject(nil, nil)
	if err != nil {
		jobObjectFailed = true
		LogError("CreateJobObject failed: %v — degraded mode, orphan processes possible on exit", err)
		return
	}
	info := windows.JOBOBJECT_EXTENDED_LIMIT_INFORMATION{
		BasicLimitInformation: windows.JOBOBJECT_BASIC_LIMIT_INFORMATION{
			LimitFlags: windows.JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
		},
	}
	if _, err := windows.SetInformationJobObject(h, windows.JobObjectExtendedLimitInformation, uintptr(unsafe.Pointer(&info)), uint32(unsafe.Sizeof(info))); err != nil {
		jobObjectFailed = true
		LogError("SetInformationJobObject failed: %v — degraded mode", err)
		return
	}
	jobObject = h
}

func JobObjectOK() bool { return !jobObjectFailed }

func AssignCurrentToJob() error {
	if jobObjectFailed {
		return fmt.Errorf("job object not available")
	}
	proc := windows.CurrentProcess()
	var dupe windows.Handle
	if err := windows.DuplicateHandle(proc, proc, proc, &dupe, 0, true, windows.DUPLICATE_SAME_ACCESS); err != nil {
		return err
	}
	return windows.AssignProcessToJobObject(jobObject, dupe)
}

func assignToJob(pid int) error {
	if jobObjectFailed {
		return nil
	}
	proc, err := windows.OpenProcess(windows.PROCESS_SET_QUOTA|windows.PROCESS_TERMINATE, false, uint32(pid))
	if err != nil {
		return err
	}
	defer windows.CloseHandle(proc)
	return windows.AssignProcessToJobObject(jobObject, proc)
}

func NewHiddenCommand(name string, arg ...string) *exec.Cmd {
	cmd := exec.Command(name, arg...)
	cmd.SysProcAttr = &syscall.SysProcAttr{
		HideWindow:    true,
		CreationFlags: 0x08000000, // CREATE_NO_WINDOW
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
	cmd.Cancel = func() error {
		err := cmd.Process.Signal(os.Kill)
		if err != nil {
			return err
		}
		return ctx.Err()
	}
	return cmd, cancel
}

func KillProcess(pid int) error {
	proc, err := os.FindProcess(pid)
	if err != nil {
		return err
	}
	return proc.Kill()
}

func ProcessExists(pid int) bool {
	h, err := windows.OpenProcess(windows.PROCESS_QUERY_LIMITED_INFORMATION, false, uint32(pid))
	if err != nil {
		return false
	}
	defer windows.CloseHandle(h)
	var exitCode uint32
	if err := windows.GetExitCodeProcess(h, &exitCode); err != nil {
		return false
	}
	return exitCode == 259 // STILL_ACTIVE
}

func KillPortOccupant(port int) error {
	cmd := NewHiddenCommand("cmd", "/c", fmt.Sprintf("netstat -ano | findstr :%d | findstr LISTENING", port))
	out, err := cmd.Output()
	if err != nil {
		return nil // port not in use
	}
	lines := bytes.Split(out, []byte("\r\n"))
	for _, line := range lines {
		fields := bytes.Fields(line)
		if len(fields) < 5 {
			continue
		}
		pidStr := string(fields[len(fields)-1])
		var pid int
		fmt.Sscanf(pidStr, "%d", &pid)
		if pid == 0 || pid == os.Getpid() {
			continue
		}
		KillProcess(pid)
	}
	return nil
}

func CleanupOrphanPorts() {
	ports := []int{9527, 5030, 7860, 8742, 8743, 5032, 5173, 3682}
	for _, p := range ports {
		KillPortOccupant(p)
	}
}

func IsPortInUse(port int) bool {
	cmd := NewHiddenCommand("cmd", "/c", fmt.Sprintf("netstat -ano | findstr :%d | findstr LISTENING", port))
	err := cmd.Run()
	return err == nil
}
