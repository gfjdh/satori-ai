package api

import (
	"net/http"
	"satori-launcher/svc"
)

func (s *Server) handleServicesList(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, s.mgr.AllServices())
}

func (s *Server) handleServicesStartAll(w http.ResponseWriter, r *http.Request) {
	errs := s.mgr.StartAll()
	if len(errs) > 0 {
		msgs := make([]string, len(errs))
		for i, e := range errs {
			msgs[i] = e.Error()
		}
		writeJSON(w, http.StatusInternalServerError, map[string]any{"errors": msgs})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *Server) handleServicesStopAll(w http.ResponseWriter, r *http.Request) {
	errs := s.mgr.StopAll()
	if len(errs) > 0 {
		msgs := make([]string, len(errs))
		for i, e := range errs {
			msgs[i] = e.Error()
		}
		writeJSON(w, http.StatusInternalServerError, map[string]any{"errors": msgs})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *Server) handleServiceStart(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	if err := s.mgr.Start(name); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *Server) handleServiceStop(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	if err := s.mgr.Stop(name); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *Server) handleLogStream(w http.ResponseWriter, r *http.Request) {
	write, _, ok := sseWriter(w)
	if !ok {
		return
	}

	ch := make(chan svc.LogEntry, 100)
	s.logClientsMu.Lock()
	s.logClients[ch] = struct{}{}
	s.logClientsMu.Unlock()

	defer func() {
		s.logClientsMu.Lock()
		delete(s.logClients, ch)
		s.logClientsMu.Unlock()
	}()

	for {
		select {
		case entry := <-ch:
			write(entry)
		case <-r.Context().Done():
			return
		}
	}
}
