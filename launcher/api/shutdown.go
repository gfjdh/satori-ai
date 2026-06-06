package api

import (
	"net/http"
	"os"

	"satori-launcher/svc"
)

func (s *Server) handleShutdown(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		jsonError(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	svc.LogInfo("", "shutdown requested by user")
	s.mgr.StopAll()
	svc.CleanupOrphanPorts()

	jsonOK(w, map[string]string{"status": "shutting down"})

	flusher, ok := w.(http.Flusher)
	if ok {
		flusher.Flush()
	}

	os.Exit(0)
}
