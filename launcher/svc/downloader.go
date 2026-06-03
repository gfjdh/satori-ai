package svc

import (
	"archive/zip"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

var httpClient = &http.Client{
	Timeout: 2 * time.Minute,
	Transport: &http.Transport{
		DialContext:           (&net.Dialer{Timeout: 30 * time.Second}).DialContext,
		TLSHandshakeTimeout:   30 * time.Second,
		ResponseHeaderTimeout: 60 * time.Second,
	},
}

type RuntimeAsset struct {
	Name    string
	URL     string
	DestDir string
}

type DownloadProgress struct {
	Asset    string `json:"asset"`
	Status   string `json:"status"`
	Progress int    `json:"progress"`
	Error    string `json:"error,omitempty"`
}

var RuntimeAssets = map[string]RuntimeAsset{
	"node": {
		Name:    "Node.js",
		URL:     "https://nodejs.org/dist/v22.22.3/node-v22.22.3-win-x64.zip",
		DestDir: "runtime/node",
	},
	"python-3.12": {
		Name:    "Python 3.12",
		URL:     "https://www.python.org/ftp/python/3.12.10/python-3.12.10-embed-amd64.zip",
		DestDir: "runtime/python-3.12",
	},
	"python-3.13": {
		Name:    "Python 3.13",
		URL:     "https://www.python.org/ftp/python/3.13.13/python-3.13.13-embed-amd64.zip",
		DestDir: "runtime/python-3.13",
	},
}

func InstallRuntime(rootDir, key, zipPath string, progress chan<- DownloadProgress) {
	asset, ok := RuntimeAssets[key]
	if !ok {
		progress <- DownloadProgress{Asset: key, Status: "error", Error: "unknown runtime: " + key}
		return
	}

	destDir := filepath.Join(rootDir, asset.DestDir)
	if IsRuntimeReady(rootDir, key) {
		progress <- DownloadProgress{Asset: key, Status: "done", Progress: 100}
		return
	}

	// For Python runtimes: if the directory was already extracted but setup
	// (pip/virtualenv) failed or was interrupted, just re-run setup.
	if strings.HasPrefix(key, "python-") {
		if _, err := os.Stat(filepath.Join(destDir, "python.exe")); err == nil {
			progress <- DownloadProgress{Asset: key, Status: "setting-up", Progress: 50}
			if err := setupEmbeddedPython(destDir, key, rootDir, progress); err != nil {
				progress <- DownloadProgress{Asset: key, Status: "error", Error: err.Error()}
				return
			}
			progress <- DownloadProgress{Asset: key, Status: "done", Progress: 100}
			return
		}
	}

	// Validate the zip file exists and is readable
	if _, err := os.Stat(zipPath); err != nil {
		progress <- DownloadProgress{Asset: key, Status: "error", Error: "file not found: " + zipPath}
		return
	}

	progress <- DownloadProgress{Asset: key, Status: "extracting", Progress: 10}
	if err := extractZip(zipPath, destDir, key, progress); err != nil {
		progress <- DownloadProgress{Asset: key, Status: "error", Error: err.Error()}
		return
	}

	// Python embeddable: enable site-packages + install pip + virtualenv
	if strings.HasPrefix(key, "python-") {
		progress <- DownloadProgress{Asset: key, Status: "setting-up", Progress: 90}
		if err := setupEmbeddedPython(destDir, key, rootDir, progress); err != nil {
			progress <- DownloadProgress{Asset: key, Status: "error", Error: err.Error()}
			return
		}
	}

	progress <- DownloadProgress{Asset: key, Status: "done", Progress: 100}
}

func extractZip(src, dest, key string, progress chan<- DownloadProgress) error {
	os.RemoveAll(dest)
	r, err := zip.OpenReader(src)
	if err != nil {
		return fmt.Errorf("cannot open zip: %w", err)
	}
	defer r.Close()

	if err := os.MkdirAll(dest, 0755); err != nil {
		return err
	}

	count := 0
	total := len(r.File)
	for _, f := range r.File {
		destPath := filepath.Join(dest, f.Name)
		cleanDest := filepath.Clean(dest) + string(os.PathSeparator)
		if !strings.HasPrefix(filepath.Clean(destPath), filepath.Clean(cleanDest)) {
			return fmt.Errorf("illegal file path: %s", f.Name)
		}

		if f.FileInfo().IsDir() {
			os.MkdirAll(destPath, 0755)
			continue
		}

		os.MkdirAll(filepath.Dir(destPath), 0755)
		rc, err := f.Open()
		if err != nil {
			return err
		}
		out, err := os.Create(destPath)
		if err != nil {
			rc.Close()
			return err
		}
		io.Copy(out, rc)
		out.Close()
		rc.Close()

		count++
		if count%10 == 0 {
			progress <- DownloadProgress{
				Asset:    key,
				Status:   "extracting",
				Progress: 10 + (count * 75 / total),
			}
		}
	}

	flattenSingleSubdir(dest)
	return nil
}

func flattenSingleSubdir(dir string) {
	entries, err := os.ReadDir(dir)
	if err != nil || len(entries) != 1 || !entries[0].IsDir() {
		return
	}

	subDir := filepath.Join(dir, entries[0].Name())
	subEntries, err := os.ReadDir(subDir)
	if err != nil {
		return
	}

	for _, e := range subEntries {
		os.Rename(filepath.Join(subDir, e.Name()), filepath.Join(dir, e.Name()))
	}
	os.Remove(subDir)
}

func setupEmbeddedPython(pythonDir, key, rootDir string, progress chan<- DownloadProgress) error {
	// 1. Edit python*._pth to enable site-packages
	entries, err := os.ReadDir(pythonDir)
	if err != nil {
		return fmt.Errorf("read python dir: %w", err)
	}
	var pthPath string
	for _, e := range entries {
		if strings.HasPrefix(e.Name(), "python") && strings.HasSuffix(e.Name(), "._pth") {
			pthPath = filepath.Join(pythonDir, e.Name())
			break
		}
	}
	if pthPath == "" {
		return fmt.Errorf("_pth file not found in %s", pythonDir)
	}

	content, err := os.ReadFile(pthPath)
	if err != nil {
		return fmt.Errorf("read _pth: %w", err)
	}
	lines := strings.Split(string(content), "\n")
	var newLines []string
	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if trimmed == "#import site" {
			newLines = append(newLines, "import site")
		} else if trimmed == "import site" {
			newLines = append(newLines, "import site")
		} else {
			newLines = append(newLines, line)
		}
	}
	if err := os.WriteFile(pthPath, []byte(strings.Join(newLines, "\n")), 0644); err != nil {
		return fmt.Errorf("write _pth: %w", err)
	}

	// 2. Find python.exe
	pythonExe := filepath.Join(pythonDir, "python.exe")
	if _, err := os.Stat(pythonExe); err != nil {
		return fmt.Errorf("python.exe not found in %s", pythonDir)
	}

	// 3. Download get-pip.py (small bootstrap, ~2MB) and install pip
	getPipURL := "https://bootstrap.pypa.io/get-pip.py"
	getPipPath := filepath.Join(pythonDir, "get-pip.py")

	resp, err := httpClient.Get(getPipURL)
	if err != nil {
		return fmt.Errorf("download get-pip.py: %w", err)
	}
	defer resp.Body.Close()

	out, err := os.Create(getPipPath)
	if err != nil {
		return err
	}
	io.Copy(out, resp.Body)
	out.Close()

	cmd, cancel := NewHiddenCommandTimeout(2*time.Minute, pythonExe, getPipPath)
	defer cancel()
	if _, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("install pip: %w", err)
	}
	os.Remove(getPipPath)

	// 4. Install virtualenv (embedded Python lacks the venv module)
	pipExe := filepath.Join(pythonDir, "Scripts", "pip.exe")
	veCmd, veCancel := NewPipCommandTimeout(3*time.Minute, pipExe, "install", "virtualenv")
	defer veCancel()
	if out, err := veCmd.CombinedOutput(); err != nil {
		return fmt.Errorf("install virtualenv: %w\n%s", err, string(out))
	}

	return nil
}

func IsRuntimeReady(rootDir, key string) bool {
	asset, ok := RuntimeAssets[key]
	if !ok {
		return false
	}
	destDir := filepath.Join(rootDir, asset.DestDir)
	entries, err := os.ReadDir(destDir)
	if err != nil {
		return false
	}
	if len(entries) == 0 {
		return false
	}
	// Python runtimes also need virtualenv installed before they're usable
	if strings.HasPrefix(key, "python-") {
		if _, err := os.Stat(filepath.Join(destDir, "Scripts", "virtualenv.exe")); err != nil {
			return false
		}
	}
	return true
}

func GetRuntimeExe(rootDir, key string) string {
	asset, ok := RuntimeAssets[key]
	if !ok {
		return ""
	}
	destDir := filepath.Join(rootDir, asset.DestDir)
	if strings.HasPrefix(key, "node") {
		return filepath.Join(destDir, "node.exe")
	}
	return filepath.Join(destDir, "python.exe")
}

