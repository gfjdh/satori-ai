package api

import (
	"io"
	"net/http"
	"os"
	"path/filepath"
	"satori-launcher/svc"
	"strings"
)

func (s *Server) handleRuntimeStatus(w http.ResponseWriter, r *http.Request) {
	result := make(map[string]bool)
	for key := range svc.RuntimeAssets {
		result[key] = svc.IsRuntimeReady(s.rootDir, key)
	}
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) handleRuntimeInfo(w http.ResponseWriter, r *http.Request) {
	type assetInfo struct {
		Key  string `json:"key"`
		Name string `json:"name"`
		URL  string `json:"url"`
	}
	var assets []assetInfo
	for key, a := range svc.RuntimeAssets {
		assets = append(assets, assetInfo{Key: key, Name: a.Name, URL: a.URL})
	}
	writeJSON(w, http.StatusOK, assets)
}

func (s *Server) handleRuntimeInstall(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	if _, ok := svc.RuntimeAssets[name]; !ok {
		writeError(w, http.StatusNotFound, "unknown runtime: "+name)
		return
	}

	var body struct {
		Path string `json:"path"`
	}
	if err := decodeBody(r, &body); err != nil || body.Path == "" {
		writeError(w, http.StatusBadRequest, "missing 'path' field")
		return
	}

	// Resolve ~ to home directory
	zipPath := body.Path
	if strings.HasPrefix(zipPath, "~") {
		home, _ := os.UserHomeDir()
		zipPath = filepath.Join(home, zipPath[1:])
	}

	write, _, ok := sseWriter(w)
	if !ok {
		return
	}

	progress := make(chan svc.DownloadProgress, 10)
	go func() {
		svc.InstallRuntime(s.rootDir, name, zipPath, progress)
		close(progress)
	}()

	for p := range progress {
		write(p)
	}
}

func (s *Server) handleUploadTemp(w http.ResponseWriter, r *http.Request) {
	r.ParseMultipartForm(500 << 20)
	file, header, err := r.FormFile("file")
	if err != nil {
		writeError(w, http.StatusBadRequest, "missing file in form field 'file'")
		return
	}
	defer file.Close()

	tmpDir := filepath.Join(s.rootDir, "data", "tmp")
	os.MkdirAll(tmpDir, 0755)

	destPath := filepath.Join(tmpDir, header.Filename)
	out, err := os.Create(destPath)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "cannot create temp file")
		return
	}
	defer out.Close()

	if _, err := io.Copy(out, file); err != nil {
		writeError(w, http.StatusInternalServerError, "write failed")
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"path": destPath})
}
