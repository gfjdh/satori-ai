package svc

import (
	"os"
	"os/exec"
	"syscall"
)

func NewHiddenCommand(name string, arg ...string) *exec.Cmd {
	cmd := exec.Command(name, arg...)
	cmd.SysProcAttr = &syscall.SysProcAttr{
		HideWindow:    true,
		CreationFlags: 0x08000000, // CREATE_NO_WINDOW — prevents child process console windows
	}
	return cmd
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
