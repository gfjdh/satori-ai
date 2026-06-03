package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"satori-launcher/svc"
)

type Server struct {
	mgr     *svc.Manager
	rootDir string

	logClients   map[chan svc.LogEntry]struct{}
	logClientsMu sync.Mutex
}

func NewServer(rootDir string) *Server {
	s := &Server{
		mgr:        svc.NewManager(rootDir),
		rootDir:    rootDir,
		logClients: make(map[chan svc.LogEntry]struct{}),
	}
	go s.broadcastLogs()
	return s
}

func (s *Server) Manager() *svc.Manager { return s.mgr }

func (s *Server) Routes() http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("GET /api/env", s.handleEnv)
	mux.HandleFunc("GET /api/env/guide/{tool}", s.handleEnvGuide)
	mux.HandleFunc("GET /api/runtime/status", s.handleRuntimeStatus)
	mux.HandleFunc("GET /api/runtime/info", s.handleRuntimeInfo)
	mux.HandleFunc("POST /api/runtime/install/{name}", s.handleRuntimeInstall)
	mux.HandleFunc("POST /api/init", s.handleInit)
	mux.HandleFunc("GET /api/services", s.handleServicesList)
	mux.HandleFunc("POST /api/services/start", s.handleServicesStartAll)
	mux.HandleFunc("POST /api/services/stop", s.handleServicesStopAll)
	mux.HandleFunc("POST /api/services/{name}/start", s.handleServiceStart)
	mux.HandleFunc("POST /api/services/{name}/stop", s.handleServiceStop)
	mux.HandleFunc("GET /api/logs/stream", s.handleLogStream)
	mux.HandleFunc("POST /api/upload/temp", s.handleUploadTemp)
	mux.HandleFunc("GET /api/project/status", s.handleProjectStatus)
	mux.HandleFunc("POST /api/project/init", s.handleProjectInit)
	mux.HandleFunc("POST /api/update/check", s.handleUpdateCheck)
	mux.HandleFunc("POST /api/update/apply", s.handleUpdateApply)
	mux.HandleFunc("GET /api/config", s.handleConfigGet)
	mux.HandleFunc("POST /api/config", s.handleConfigPost)
	mux.HandleFunc("POST /api/update/deps/{name}", s.handleUpdateDeps)
	mux.HandleFunc("POST /api/shutdown", s.handleShutdown)

	return withCORS(mux)
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

func decodeBody(r *http.Request, v any) error {
	defer r.Body.Close()
	return json.NewDecoder(r.Body).Decode(v)
}

func withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Server) broadcastLogs() {
	for entry := range s.mgr.LogChannel() {
		s.logClientsMu.Lock()
		for ch := range s.logClients {
			select {
			case ch <- entry:
			default:
			}
		}
		s.logClientsMu.Unlock()
	}
}

func sseWriter(w http.ResponseWriter) (func(any), http.Flusher, bool) {
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "SSE not supported", http.StatusInternalServerError)
		return nil, nil, false
	}
	write := func(v any) {
		data, _ := json.Marshal(v)
		fmt.Fprintf(w, "data: %s\n\n", data)
		flusher.Flush()
	}
	return write, flusher, true
}
