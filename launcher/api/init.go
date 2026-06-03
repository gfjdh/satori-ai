package api

import (
	"net/http"
)

func (s *Server) handleInit(w http.ResponseWriter, r *http.Request) {
	write, flusher, ok := sseWriter(w)
	if !ok {
		return
	}

	var body struct {
		Services []string `json:"services"`
	}
	decodeBody(r, &body)

	done := make(chan struct{})
	go func() {
		s.mgr.InitEnvironment(body.Services...)
		close(done)
	}()

	for {
		select {
		case entry, alive := <-s.mgr.LogChannel():
			if !alive {
				return
			}
			write(entry)
		case <-done:
			write(map[string]string{"type": "done"})
			flusher.Flush()
			return
		case <-r.Context().Done():
			return
		}
	}
}
