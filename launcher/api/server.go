package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"satori-launcher/svc"
)

type Server struct {
	mgr     *svc.Manager
	rootDir string
	mux     *http.ServeMux
}

func NewServer(mgr *svc.Manager, rootDir string) *Server {
	s := &Server{
		mgr:     mgr,
		rootDir: rootDir,
		mux:     http.NewServeMux(),
	}
	s.registerRoutes()
	return s
}

func (s *Server) Handler() http.Handler {
	return s.mux
}

func (s *Server) registerRoutes() {
	s.mux.HandleFunc("/api/status", s.handleStatus)
	s.mux.HandleFunc("/api/env", s.handleEnv)
	s.mux.HandleFunc("/api/services", s.handleServicesList)
	s.mux.HandleFunc("/api/services/start-all", s.handleServicesStartAll)
	s.mux.HandleFunc("/api/services/stop-all", s.handleServicesStopAll)
	s.mux.HandleFunc("/api/services/health", s.handleHealthCheck)
	s.mux.HandleFunc("/api/services/", s.handleServiceAction)
	s.mux.HandleFunc("/api/logs/stream", s.handleLogStream)
	s.mux.HandleFunc("/api/config", s.handleConfig)
	s.mux.HandleFunc("/api/setup/init-all", s.handleInitAll)
	s.mux.HandleFunc("/api/shutdown", s.handleShutdown)
}

func (s *Server) handleStatus(w http.ResponseWriter, r *http.Request) {
	jsonOK(w, map[string]interface{}{
		"jobObjectOK": svc.JobObjectOK(),
		"version":     "4.0.0",
	})
}

func (s *Server) handleEnv(w http.ResponseWriter, r *http.Request) {
	runtimes := svc.DetectRuntimes(s.rootDir)
	jsonOK(w, map[string]interface{}{
		"runtimes": runtimes,
		"allReady": svc.AllRuntimesReady(s.rootDir),
	})
}

func (s *Server) handleServicesList(w http.ResponseWriter, r *http.Request) {
	s.mgr.RefreshAll()
	jsonOK(w, s.mgr.GetStates())
}

func (s *Server) handleServicesStartAll(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		jsonError(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	svc.LogInfo("", "starting all services")
	errors := s.mgr.StartAll()
	jsonOK(w, map[string]interface{}{"errors": errors})
}

func (s *Server) handleServicesStopAll(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		jsonError(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	svc.LogInfo("", "stopping all services")
	s.mgr.StopAll()
	jsonOK(w, map[string]string{"status": "ok"})
}

func (s *Server) handleHealthCheck(w http.ResponseWriter, r *http.Request) {
	jsonOK(w, s.mgr.CheckHealthAll())
}

func (s *Server) handleServiceAction(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		jsonError(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// path: /api/services/{name}/start | /api/services/{name}/stop | /api/services/{name}/setup
	parts := strings.Split(strings.TrimPrefix(r.URL.Path, "/api/services/"), "/")
	if len(parts) != 2 {
		jsonError(w, "invalid path", http.StatusBadRequest)
		return
	}
	name, action := parts[0], parts[1]

	var err error
	switch action {
	case "start":
		err = s.mgr.Start(name)
	case "stop":
		err = s.mgr.Stop(name)
	case "setup":
		err = s.mgr.Setup(name)
	default:
		jsonError(w, "unknown action: "+action, http.StatusBadRequest)
		return
	}

	if err != nil {
		jsonError(w, err.Error(), http.StatusInternalServerError)
		return
	}
	jsonOK(w, s.mgr.GetState(name))
}

func (s *Server) handleLogStream(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming not supported", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	ch := svc.SubscribeLogs()
	defer svc.UnsubscribeLogs(ch)

	ctx := r.Context()
	for {
		select {
		case <-ctx.Done():
			return
		case entry, ok := <-ch:
			if !ok {
				return
			}
			data, _ := json.Marshal(entry)
			fmt.Fprintf(w, "data: %s\n\n", data)
			flusher.Flush()
		case <-time.After(15 * time.Second):
			fmt.Fprintf(w, ": keepalive\n\n")
			flusher.Flush()
		}
	}
}

func (s *Server) handleInitAll(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		jsonError(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	svc.LogInfo("", "init-all started")
	s.mgr.RefreshAll()
	states := s.mgr.GetStates()

	var errors []string
	for _, state := range states {
		if state.Status == svc.StatusNotInstalled {
			if err := s.mgr.Setup(state.Name); err != nil {
				errors = append(errors, fmt.Sprintf("%s: %v", state.Name, err))
			}
		}
	}

	svc.LogInfo("", "init-all complete, errors=%d", len(errors))
	jsonOK(w, map[string]interface{}{"errors": errors})
}

func jsonOK(w http.ResponseWriter, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(data)
}

func jsonError(w http.ResponseWriter, msg string, code int) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(map[string]string{"error": msg})
}
