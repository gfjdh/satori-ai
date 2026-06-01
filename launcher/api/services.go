package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"time"
)

func (s *Server) handleServices(w http.ResponseWriter, r *http.Request) {
	svcs := s.mgr.AllServices()
	writeJSON(w, svcs)
}

func (s *Server) handleServiceStart(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	if err := s.mgr.Start(name); err != nil {
		writeJSON(w, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, map[string]string{"status": "ok"})
}

func (s *Server) handleServiceStop(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	if err := s.mgr.Stop(name); err != nil {
		writeJSON(w, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, map[string]string{"status": "ok"})
}

func (s *Server) handleStartAll(w http.ResponseWriter, r *http.Request) {
	errs := s.mgr.StartAll()
	if len(errs) > 0 {
		msgs := make([]string, len(errs))
		for i, e := range errs {
			msgs[i] = e.Error()
		}
		writeJSON(w, map[string]interface{}{"errors": msgs})
		return
	}
	writeJSON(w, map[string]string{"status": "ok"})
}

func (s *Server) handleStopAll(w http.ResponseWriter, r *http.Request) {
	errs := s.mgr.StopAll()
	if len(errs) > 0 {
		msgs := make([]string, len(errs))
		for i, e := range errs {
			msgs[i] = e.Error()
		}
		writeJSON(w, map[string]interface{}{"errors": msgs})
		return
	}
	writeJSON(w, map[string]string{"status": "ok"})
}

func (s *Server) handleInitEnv(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")

	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming not supported", http.StatusInternalServerError)
		return
	}

	logCh := s.mgr.LogChannel()
	s.mgr.InitEnvironment()

	timeout := time.After(10 * time.Minute)
	for {
		select {
		case entry := <-logCh:
			data, _ := json.Marshal(entry)
			fmt.Fprintf(w, "data: %s\n\n", data)
			flusher.Flush()
		case <-timeout:
			return
		case <-r.Context().Done():
			return
		}
	}
}

func (s *Server) handleLogStream(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")

	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming not supported", http.StatusInternalServerError)
		return
	}

	logCh := s.mgr.LogChannel()
	for {
		select {
		case entry := <-logCh:
			data, _ := json.Marshal(entry)
			fmt.Fprintf(w, "data: %s\n\n", data)
			flusher.Flush()
		case <-r.Context().Done():
			return
		}
	}
}
