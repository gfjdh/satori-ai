package api

import (
	"net/http"

	"satori-launcher/svc"
)

type Server struct {
	mgr *svc.Manager
	mux *http.ServeMux
}

func NewServer(mgr *svc.Manager) *Server {
	s := &Server{mgr: mgr, mux: http.NewServeMux()}
	s.registerRoutes()
	return s
}

func (s *Server) Handler() http.Handler {
	return s.mux
}

func (s *Server) registerRoutes() {
	s.mux.HandleFunc("GET /api/env", s.handleEnv)
	s.mux.HandleFunc("GET /api/env/install-guide/{tool}", s.handleInstallGuide)
	s.mux.HandleFunc("GET /api/services", s.handleServices)
	s.mux.HandleFunc("POST /api/services/{name}/start", s.handleServiceStart)
	s.mux.HandleFunc("POST /api/services/{name}/stop", s.handleServiceStop)
	s.mux.HandleFunc("POST /api/services/{name}/update-deps", s.handleServiceUpdateDeps)
	s.mux.HandleFunc("POST /api/services/start-all", s.handleStartAll)
	s.mux.HandleFunc("POST /api/services/stop-all", s.handleStopAll)
	s.mux.HandleFunc("GET /api/logs/stream", s.handleLogStream)
	s.mux.HandleFunc("POST /api/init-env", s.handleInitEnv)
	s.mux.HandleFunc("POST /api/update/check", s.handleUpdateCheck)
	s.mux.HandleFunc("POST /api/update/deps", s.handleUpdateDeps)
	s.mux.HandleFunc("POST /api/update/apply", s.handleUpdateApply)
}
