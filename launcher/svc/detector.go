package svc

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"golang.org/x/sys/windows/registry"
)

type EnvStatus string

const (
	EnvOK      EnvStatus = "ok"
	EnvMissing EnvStatus = "missing"
	EnvError   EnvStatus = "error"
)

type EnvInfo struct {
	Status  EnvStatus `json:"status"`
	Version string    `json:"version"`
	Path    string    `json:"path"`
	Hint    string    `json:"hint,omitempty"`
}

type EnvResult struct {
	Node    EnvInfo   `json:"node"`
	Python  []EnvInfo `json:"python"`
	Git     EnvInfo   `json:"git"`
}

func DetectAll() EnvResult {
	return EnvResult{
		Node:   detectNode(),
		Python: detectPythonVersions(),
		Git:    detectGit(),
	}
}

func FindBestPython(minMinor, maxMinor int) (string, error) {
	versions := detectPythonVersions()
	for _, v := range versions {
		if v.Status != EnvOK {
			continue
		}
		minor := parseMinorVersion(v.Version)
		if minor >= minMinor && minor <= maxMinor {
			return v.Path, nil
		}
	}
	return "", fmt.Errorf("no Python %d.x found", minMinor)
}

func parseMinorVersion(ver string) int {
	// "Python 3.12.7" -> 12
	parts := strings.Split(strings.TrimSpace(ver), ".")
	if len(parts) < 2 {
		return 0
	}
	// Get the second component (e.g., "12" from "3.12.7")
	majorMinor := strings.Split(parts[0], " ")
	minorStr := ""
	if len(majorMinor) >= 2 {
		minorStr = majorMinor[1]
	}
	if minorStr == "" {
		minorStr = parts[1]
	}
	var minor int
	fmt.Sscanf(minorStr, "%d", &minor)
	return minor
}

func detectNode() EnvInfo {
	path, err := exec.LookPath("node")
	if err != nil {
		path = findNodeInRegistry()
		if path == "" {
			return EnvInfo{
				Status: EnvMissing,
				Hint:   "https://nodejs.org/ - download LTS version",
			}
		}
	}

	ver, err := runVersion(path, "--version")
	if err != nil {
		return EnvInfo{Status: EnvError, Path: path}
	}

	return EnvInfo{Status: EnvOK, Version: strings.TrimSpace(ver), Path: path}
}

func findNodeInRegistry() string {
	k, err := registry.OpenKey(registry.LOCAL_MACHINE, `SOFTWARE\Node.js`, registry.QUERY_VALUE)
	if err != nil {
		return ""
	}
	defer k.Close()

	v, _, err := k.GetStringValue("InstallPath")
	if err != nil {
		return ""
	}
	return v + `\node.exe`
}

func detectPythonVersions() []EnvInfo {
	var result []EnvInfo
	seen := make(map[string]bool)

	// 1. Scan registry for all Python installations
	registryPythons := findAllPythonInRegistry()
	for _, p := range registryPythons {
		if seen[p] {
			continue
		}
		seen[p] = true
		ver, err := runVersion(p, "--version")
		if err != nil {
			result = append(result, EnvInfo{Status: EnvError, Path: p})
			continue
		}
		result = append(result, EnvInfo{Status: EnvOK, Version: strings.TrimSpace(ver), Path: p})
	}

	// 2. Also check PATH for python/python3 (skip Windows Store stubs)
	for _, name := range []string{"python", "python3"} {
		path, err := exec.LookPath(name)
		if err != nil {
			continue
		}
		// Skip WindowsApps store stubs — they don't work for venv/pip
		if strings.Contains(path, "WindowsApps") {
			continue
		}
		resolved, err := filepath.EvalSymlinks(path)
		if err == nil {
			path = resolved
		}
		if seen[path] {
			continue
		}
		seen[path] = true
		ver, err := runVersion(path, "--version")
		if err != nil {
			result = append(result, EnvInfo{Status: EnvError, Path: path})
			continue
		}
		result = append(result, EnvInfo{Status: EnvOK, Version: strings.TrimSpace(ver), Path: path})
	}

	// 3. Check common install locations as fallback
	commonDirs := []string{
		os.ExpandEnv(`C:\Python312\python.exe`),
		os.ExpandEnv(`C:\Python313\python.exe`),
		os.ExpandEnv(`C:\Users\$USERNAME\AppData\Local\Programs\Python\Python312\python.exe`),
		os.ExpandEnv(`C:\Users\$USERNAME\AppData\Local\Programs\Python\Python313\python.exe`),
	}
	for _, p := range commonDirs {
		p = os.ExpandEnv(strings.Replace(p, "$USERNAME", os.Getenv("USERNAME"), 1))
		if seen[p] {
			continue
		}
		if _, err := os.Stat(p); err != nil {
			continue
		}
		seen[p] = true
		ver, err := runVersion(p, "--version")
		if err != nil {
			result = append(result, EnvInfo{Status: EnvError, Path: p})
			continue
		}
		result = append(result, EnvInfo{Status: EnvOK, Version: strings.TrimSpace(ver), Path: p})
	}

	if len(result) == 0 {
		result = append(result, EnvInfo{
			Status: EnvMissing,
			Hint:   "https://www.python.org/downloads/ - check 'Add Python to PATH' during install",
		})
	}

	return result
}

func findAllPythonInRegistry() []string {
	var paths []string

	for _, root := range []registry.Key{registry.LOCAL_MACHINE, registry.CURRENT_USER} {
		k, err := registry.OpenKey(root, `SOFTWARE\Python\PythonCore`, registry.ENUMERATE_SUB_KEYS)
		if err != nil {
			continue
		}
		names, err := k.ReadSubKeyNames(0)
		k.Close()
		if err != nil {
			continue
		}
		for _, name := range names {
			ik, err := registry.OpenKey(root, `SOFTWARE\Python\PythonCore\`+name+`\InstallPath`, registry.QUERY_VALUE)
			if err != nil {
				continue
			}
			// Try ExecutablePath first, then default value
			v, _, err := ik.GetStringValue("ExecutablePath")
			if err != nil || v == "" {
				v, _, err = ik.GetStringValue("")
			}
			ik.Close()
			if v != "" {
				if !strings.HasSuffix(v, ".exe") {
					v = filepath.Join(v, "python.exe")
				}
				paths = append(paths, v)
			}
		}
	}
	return paths
}

func detectGit() EnvInfo {
	path, err := exec.LookPath("git")
	if err != nil {
		return EnvInfo{
			Status: EnvMissing,
			Hint:   "https://git-scm.com/download/win",
		}
	}

	ver, err := runVersion(path, "--version")
	if err != nil {
		return EnvInfo{Status: EnvError, Path: path}
	}
	return EnvInfo{Status: EnvOK, Version: strings.TrimSpace(ver), Path: path}
}

func runVersion(exe, flag string) (string, error) {
	cmd := exec.Command(exe, flag)
	out, err := cmd.Output()
	if err != nil {
		return "", err
	}
	return string(out), nil
}
