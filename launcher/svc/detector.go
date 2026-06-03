package svc

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
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
	Node   EnvInfo   `json:"node"`
	Python []EnvInfo `json:"python"`
	Git    EnvInfo   `json:"git"`
}

func DetectAll(rootDir string) EnvResult {
	return EnvResult{
		Node:   detectNode(rootDir),
		Python: detectPythonVersions(rootDir),
		Git:    detectGit(),
	}
}

func detectNode(rootDir string) EnvInfo {
	// 1. bundled runtime
	bundled := filepath.Join(rootDir, "runtime", "node", "node.exe")
	if v, err := runVersion(bundled, "-v"); err == nil {
		return EnvInfo{Status: EnvOK, Version: v, Path: bundled}
	}

	// 2. system PATH
	if p, err := exec.LookPath("node"); err == nil {
		if v, err := runVersion(p, "-v"); err == nil {
			return EnvInfo{Status: EnvOK, Version: v, Path: p}
		}
		return EnvInfo{Status: EnvOK, Path: p}
	}

	// 3. registry
	if p := findNodeInRegistry(); p != "" {
		exe := filepath.Join(p, "node.exe")
		if v, err := runVersion(exe, "-v"); err == nil {
			return EnvInfo{Status: EnvOK, Version: v, Path: exe}
		}
		return EnvInfo{Status: EnvOK, Path: exe}
	}

	return EnvInfo{Status: EnvMissing, Hint: "https://nodejs.org/dist/v22.22.3/node-v22.22.3-x64.msi"}
}

func findNodeInRegistry() string {
	k, err := registry.OpenKey(registry.LOCAL_MACHINE, `SOFTWARE\Node.js`, registry.QUERY_VALUE)
	if err != nil {
		return ""
	}
	defer k.Close()
	path, _, _ := k.GetStringValue("InstallPath")
	return path
}

func detectPythonVersions(rootDir string) []EnvInfo {
	var result []EnvInfo

	// 1. bundled runtimes
	for _, v := range []struct{ minor, max int }{
		{12, 12}, {13, 13},
	} {
		p := runtimePythonPath(rootDir, v.minor, v.max)
		if p != "" {
			if ver, err := runVersion(p, "--version"); err == nil {
				result = append(result, EnvInfo{Status: EnvOK, Version: ver, Path: p})
			}
		}
	}

	// 2. registry
	for _, p := range findAllPythonInRegistry() {
		if ver, err := runVersion(p, "--version"); err == nil {
			// skip duplicates (same path)
			dup := false
			for _, r := range result {
				if r.Path == p {
					dup = true
					break
				}
			}
			if !dup {
				result = append(result, EnvInfo{Status: EnvOK, Version: ver, Path: p})
			}
		}
	}

	// 3. PATH
	for _, name := range []string{"python", "python3"} {
		p, err := exec.LookPath(name)
		if err != nil {
			continue
		}
		// skip WindowsApps stubs
		if strings.Contains(strings.ToLower(p), "windowsapps") {
			continue
		}
		if ver, err := runVersion(p, "--version"); err == nil {
			dup := false
			for _, r := range result {
				if r.Path == p {
					dup = true
					break
				}
			}
			if !dup {
				result = append(result, EnvInfo{Status: EnvOK, Version: ver, Path: p})
			}
		}
	}

	// 4. common locations
	for _, loc := range []string{
		`C:\Python312\python.exe`,
		`C:\Python313\python.exe`,
		os.ExpandEnv(`%LOCALAPPDATA%\Programs\Python\Python312\python.exe`),
		os.ExpandEnv(`%LOCALAPPDATA%\Programs\Python\Python313\python.exe`),
	} {
		if _, err := os.Stat(loc); err == nil {
			if ver, err := runVersion(loc, "--version"); err == nil {
				dup := false
				for _, r := range result {
					if r.Path == loc {
						dup = true
						break
					}
				}
				if !dup {
					result = append(result, EnvInfo{Status: EnvOK, Version: ver, Path: loc})
				}
			}
		}
	}

	if len(result) == 0 {
		result = append(result, EnvInfo{Status: EnvMissing, Hint: "需要 Python 3.12 和/或 3.13"})
	}

	return result
}

func FindBestPython(rootDir string, minMinor, maxMinor int) (string, error) {
	// 1. bundled runtime first
	if p := runtimePythonPath(rootDir, minMinor, maxMinor); p != "" {
		return p, nil
	}

	// 2. detected versions — pick highest compatible minor
	all := detectPythonVersions(rootDir)
	var best string
	bestMinor := 0
	for _, info := range all {
		if info.Status != EnvOK {
			continue
		}
		m := parseMinorVersion(info.Version)
		if m == 0 {
			continue
		}
		if m >= minMinor && (maxMinor == 0 || m <= maxMinor) && m > bestMinor {
			bestMinor = m
			best = info.Path
		}
	}
	if best != "" {
		return best, nil
	}

	return "", fmt.Errorf("no Python found matching 3.%d (max=%d)", minMinor, maxMinor)
}

func runtimePythonPath(rootDir string, minMinor, maxMinor int) string {
	start := maxMinor
	if start == 0 {
		start = 14
	}
	for minor := start; minor >= minMinor; minor-- {
		dir := filepath.Join(rootDir, "runtime", fmt.Sprintf("python-3.%d", minor))
		exe := filepath.Join(dir, "python.exe")
		if _, err := os.Stat(exe); err == nil {
			if ver, err := runVersion(exe, "--version"); err == nil {
				m := parseMinorVersion(ver)
				if m >= minMinor && (maxMinor == 0 || m <= maxMinor) {
					return exe
				}
			}
		}
	}
	return ""
}

func detectGit() EnvInfo {
	if p, err := exec.LookPath("git"); err == nil {
		if v, err := runVersion(p, "--version"); err == nil {
			return EnvInfo{Status: EnvOK, Version: v, Path: p}
		}
		return EnvInfo{Status: EnvOK, Path: p}
	}
	return EnvInfo{Status: EnvMissing, Hint: "https://github.com/git-for-windows/git/releases/download/v2.54.0.windows.1/Git-2.54.0-64-bit.exe"}
}

func parseMinorVersion(ver string) int {
	// "Python 3.12.7" → 12
	fields := strings.Fields(ver)
	if len(fields) < 2 {
		return 0
	}
	parts := strings.Split(fields[1], ".")
	if len(parts) < 2 {
		return 0
	}
	m, _ := strconv.Atoi(parts[1])
	return m
}

func findAllPythonInRegistry() []string {
	var paths []string
	for _, root := range []registry.Key{registry.LOCAL_MACHINE, registry.CURRENT_USER} {
		core, err := registry.OpenKey(root, `SOFTWARE\Python\PythonCore`, registry.ENUMERATE_SUB_KEYS)
		if err != nil {
			continue
		}
		subKeys, err := core.ReadSubKeyNames(-1)
		core.Close()
		if err != nil {
			continue
		}
		for _, sk := range subKeys {
			k, err := registry.OpenKey(root, `SOFTWARE\Python\PythonCore\`+sk+`\InstallPath`, registry.QUERY_VALUE)
			if err != nil {
				continue
			}
			p, _, err := k.GetStringValue("ExecutablePath")
			if err != nil {
				p, _, err = k.GetStringValue("") // default value
				if err != nil {
					k.Close()
					continue
				}
				p = filepath.Join(p, "python.exe")
			}
			k.Close()
			paths = append(paths, p)
		}
	}
	return paths
}

func runVersion(exe, flag string) (string, error) {
	cmd := NewHiddenCommand(exe, flag)
	out, err := cmd.Output()
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(string(out)), nil
}
