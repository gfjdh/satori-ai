package api

import (
	"encoding/json"
	"net/http"

	"satori-launcher/svc"
)

func (s *Server) handleEnv(w http.ResponseWriter, r *http.Request) {
	result := svc.DetectAll()
	writeJSON(w, result)
}

type installGuide struct {
	Tool        string `json:"tool"`
	DisplayName string `json:"displayName"`
	URL         string `json:"url"`
	Note        string `json:"note"`
}

func (s *Server) handleInstallGuide(w http.ResponseWriter, r *http.Request) {
	tool := r.PathValue("tool")
	guides := map[string]installGuide{
		"node": {
			Tool:        "node",
			DisplayName: "Node.js",
			URL:         "https://nodejs.org/en/download",
			Note:        "Download the LTS version (.msi installer). Run the installer, accept defaults.",
		},
		"python": {
			Tool:        "python",
			DisplayName: "Python 3.12",
			URL:         "https://www.python.org/downloads/release/python-3129/",
			Note:        "Download Python 3.12.x (Windows installer 64-bit). IMPORTANT: Check 'Add Python to PATH'. Some services need Python 3.12 specifically.",
		},
		"python313": {
			Tool:        "python313",
			DisplayName: "Python 3.13",
			URL:         "https://www.python.org/downloads/",
			Note:        "Download the latest Python 3.13.x. IMPORTANT: Check 'Add Python to PATH'.",
		},
		"git": {
			Tool:        "git",
			DisplayName: "Git for Windows",
			URL:         "https://git-scm.com/download/win",
			Note:        "Download Git for Windows. Use default options during installation.",
		},
	}

	guide, ok := guides[tool]
	if !ok {
		http.Error(w, "unknown tool", http.StatusNotFound)
		return
	}
	writeJSON(w, guide)
}

func writeJSON(w http.ResponseWriter, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(v)
}
