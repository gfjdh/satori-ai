package svc

import (
	"os"
	"path/filepath"
	"strings"
)

type RuntimeInfo struct {
	Name    string `json:"name"`
	Version string `json:"version"`
	Path    string `json:"path"`
	Ready   bool   `json:"ready"`
}

func DetectRuntimes(rootDir string) []RuntimeInfo {
	var result []RuntimeInfo

	nodeDir := filepath.Join(rootDir, "runtime", "node")
	nodeExe := filepath.Join(nodeDir, "node.exe")
	nodeReady := false
	nodeVersion := ""
	if _, err := os.Stat(nodeExe); err == nil {
		cmd := NewHiddenCommand(nodeExe, "--version")
		out, err := cmd.Output()
		if err == nil {
			nodeVersion = strings.TrimSpace(string(out))
			nodeReady = true
		}
	}
	result = append(result, RuntimeInfo{
		Name:    "Node.js",
		Version: nodeVersion,
		Path:    nodeDir,
		Ready:   nodeReady,
	})

	for _, ver := range []string{"3.12", "3.13"} {
		pyDir := filepath.Join(rootDir, "runtime", "python-"+ver)
		pyExe := filepath.Join(pyDir, "python.exe")
		pyReady := false
		pyVersion := ""
		if _, err := os.Stat(pyExe); err == nil {
			out, err := NewHiddenCommand(pyExe, "--version").Output()
			if err == nil {
				pyVersion = strings.TrimSpace(string(out))
				// verify pip is available
				_, pipErr := NewHiddenCommand(pyExe, "-m", "pip", "--version").Output()
				pyReady = pipErr == nil
			}
		}
		result = append(result, RuntimeInfo{
			Name:    "Python " + ver,
			Version: pyVersion,
			Path:    pyDir,
			Ready:   pyReady,
		})
	}

	return result
}

func AllRuntimesReady(rootDir string) bool {
	for _, rt := range DetectRuntimes(rootDir) {
		if !rt.Ready {
			return false
		}
	}
	return true
}
