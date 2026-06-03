package api

import (
	"net/http"
	"satori-launcher/svc"
)

func (s *Server) handleRuntimeStatus(w http.ResponseWriter, r *http.Request) {
	result := make(map[string]bool)
	for key := range svc.RuntimeAssets {
		result[key] = svc.IsRuntimeReady(s.rootDir, key)
	}
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) handleRuntimeDownload(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	if _, ok := svc.RuntimeAssets[name]; !ok {
		writeError(w, http.StatusNotFound, "unknown runtime: "+name)
		return
	}

	write, _, ok := sseWriter(w)
	if !ok {
		return
	}

	progress := make(chan svc.DownloadProgress, 10)
	go func() {
		svc.DownloadRuntime(s.rootDir, name, progress)
		close(progress)
	}()

	for p := range progress {
		write(p)
	}
}
