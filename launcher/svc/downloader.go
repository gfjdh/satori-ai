package svc

import (
	"archive/zip"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

type RuntimeAsset struct {
	Name    string
	URL     string
	DestDir string
}

type DownloadProgress struct {
	Asset      string `json:"asset"`
	Status     string `json:"status"`
	Progress   int    `json:"progress"`
	Downloaded int64  `json:"downloaded"`
	Total      int64  `json:"total"`
	Speed      string `json:"speed"`
	Error      string `json:"error,omitempty"`
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

func DownloadRuntime(rootDir, key string, progress chan<- DownloadProgress) {
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

	tmpFile := filepath.Join(filepath.Dir(destDir), key+".zip")
	os.MkdirAll(filepath.Dir(destDir), 0755)

	progress <- DownloadProgress{Asset: key, Status: "downloading", Progress: 0}
	if err := downloadFile(asset.URL, tmpFile, key, progress); err != nil {
		progress <- DownloadProgress{Asset: key, Status: "error", Error: err.Error()}
		return
	}
	defer os.Remove(tmpFile)

	progress <- DownloadProgress{Asset: key, Status: "extracting", Progress: 80}
	if err := extractZip(tmpFile, destDir, key, progress); err != nil {
		progress <- DownloadProgress{Asset: key, Status: "error", Error: err.Error()}
		return
	}

	// Python embeddable: enable site-packages + install pip
	if strings.HasPrefix(key, "python-") {
		progress <- DownloadProgress{Asset: key, Status: "setting-up", Progress: 90}
		if err := setupEmbeddedPython(destDir, key, rootDir, progress); err != nil {
			progress <- DownloadProgress{Asset: key, Status: "error", Error: err.Error()}
			return
		}
	}

	progress <- DownloadProgress{Asset: key, Status: "done", Progress: 100}
}

func downloadFile(url, dest, key string, progress chan<- DownloadProgress) error {
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return err
	}

	// resume support
	if stat, err := os.Stat(dest); err == nil && stat.Size() > 0 {
		req.Header.Set("Range", fmt.Sprintf("bytes=%d-", stat.Size()))
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return fmt.Errorf("download failed: %w", err)
	}
	defer resp.Body.Close()

	var total int64
	switch resp.StatusCode {
	case http.StatusOK:
		total = resp.ContentLength
	case http.StatusPartialContent:
		total = resp.ContentLength
	default:
		return fmt.Errorf("unexpected status: %d", resp.StatusCode)
	}

	out, err := os.Create(dest)
	if err != nil {
		return err
	}
	defer out.Close()

	startTime := time.Now()
	lastPct := -1
	pr := &progressReader{
		r:         resp.Body,
		total:     total,
		startTime: startTime,
		callback: func(downloaded int64) {
			pct := int(downloaded * 100 / total)
			if pct != lastPct {
				lastPct = pct
				elapsed := time.Since(startTime).Seconds()
				speed := ""
				if elapsed > 0 {
					bps := float64(downloaded) / elapsed
					switch {
					case bps > 1_000_000:
						speed = fmt.Sprintf("%.1f MB/s", bps/1_000_000)
					case bps > 1_000:
						speed = fmt.Sprintf("%.1f KB/s", bps/1_000)
					default:
						speed = fmt.Sprintf("%.0f B/s", bps)
					}
				}
				progress <- DownloadProgress{
					Asset:      key,
					Status:     "downloading",
					Progress:   pct,
					Downloaded: downloaded,
					Total:      total,
					Speed:      speed,
				}
			}
		},
	}

	_, err = io.Copy(out, pr)
	return err
}

type progressReader struct {
	r         io.Reader
	total     int64
	downloaded int64
	startTime time.Time
	callback  func(int64)
}

func (p *progressReader) Read(b []byte) (int, error) {
	n, err := p.r.Read(b)
	p.downloaded += int64(n)
	p.callback(p.downloaded)
	return n, err
}

func extractZip(src, dest, key string, progress chan<- DownloadProgress) error {
	os.RemoveAll(dest)
	r, err := zip.OpenReader(src)
	if err != nil {
		return err
	}
	defer r.Close()

	if err := os.MkdirAll(dest, 0755); err != nil {
		return err
	}

	count := 0
	total := len(r.File)
	for _, f := range r.File {
		destPath := filepath.Join(dest, f.Name)
		// Zip Slip protection
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
				Progress: 80 + (count*15/total),
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

	// 3. Download get-pip.py and install pip
	getPipURL := "https://bootstrap.pypa.io/get-pip.py"
	getPipPath := filepath.Join(pythonDir, "get-pip.py")

	resp, err := http.Get(getPipURL)
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

	cmd := NewHiddenCommand(pythonExe, getPipPath)
	if _, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("install pip: %w", err)
	}
	os.Remove(getPipPath)

	// 4. Install virtualenv (embedded Python lacks the venv module)
	pipExe := filepath.Join(pythonDir, "Scripts", "pip.exe")
	veCmd := NewHiddenCommand(pipExe, "install", "virtualenv")
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
	return len(entries) > 0
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

func VerifyFileSHA256(path, expected string) error {
	if expected == "" {
		return nil
	}
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()
	h := sha256.New()
	io.Copy(h, f)
	if hex.EncodeToString(h.Sum(nil)) != expected {
		return fmt.Errorf("SHA256 mismatch for %s", filepath.Base(path))
	}
	return nil
}
