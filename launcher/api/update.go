package api

import (
	"net/http"
	"os"
	"path/filepath"
	"satori-launcher/svc"
	"strings"
)

func (s *Server) handleProjectStatus(w http.ResponseWriter, r *http.Request) {
	type gitStatus struct {
		Initialized bool   `json:"initialized"`
		Branch      string `json:"branch,omitempty"`
		Remote      string `json:"remote,omitempty"`
		Error       string `json:"error,omitempty"`
	}

	gitDir := filepath.Join(s.rootDir, ".git")
	if _, err := os.Stat(gitDir); err != nil {
		writeJSON(w, http.StatusOK, gitStatus{Initialized: false})
		return
	}

	cmd := svc.NewHiddenCommand("git", "branch", "--show-current")
	cmd.Dir = s.rootDir
	out, err := cmd.Output()
	branch := "unknown"
	if err == nil {
		branch = strings.TrimSpace(string(out))
	}

	cmd = svc.NewHiddenCommand("git", "remote", "get-url", "gitee")
	cmd.Dir = s.rootDir
	out, err = cmd.Output()
	remote := ""
	if err == nil {
		remote = strings.TrimSpace(string(out))
	}

	writeJSON(w, http.StatusOK, gitStatus{
		Initialized: true,
		Branch:      branch,
		Remote:      remote,
	})
}

func (s *Server) handleProjectInit(w http.ResponseWriter, r *http.Request) {
	var body struct {
		GiteeURL  string `json:"giteeUrl"`
		GithubURL string `json:"githubUrl,omitempty"`
	}
	if err := decodeBody(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}

	gitDir := filepath.Join(s.rootDir, ".git")
	if _, err := os.Stat(gitDir); err == nil {
		writeError(w, http.StatusBadRequest, "already initialized")
		return
	}

	cmd := svc.NewHiddenCommand("git", "init")
	cmd.Dir = s.rootDir
	if out, err := cmd.CombinedOutput(); err != nil {
		writeError(w, http.StatusInternalServerError, "git init: "+string(out))
		return
	}

	if body.GiteeURL != "" {
		cmd = svc.NewHiddenCommand("git", "remote", "add", "gitee", body.GiteeURL)
		cmd.Dir = s.rootDir
		cmd.CombinedOutput()
	}

	if body.GithubURL != "" {
		cmd = svc.NewHiddenCommand("git", "remote", "add", "github", body.GithubURL)
		cmd.Dir = s.rootDir
		cmd.CombinedOutput()
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *Server) handleUpdateCheck(w http.ResponseWriter, r *http.Request) {
	cmd := svc.NewHiddenCommand("git", "fetch", "gitee")
	cmd.Dir = s.rootDir
	if out, err := cmd.CombinedOutput(); err != nil {
		writeError(w, http.StatusInternalServerError, "git fetch: "+string(out))
		return
	}

	cmd = svc.NewHiddenCommand("git", "rev-list", "--count", "HEAD..gitee/main")
	cmd.Dir = s.rootDir
	out, err := cmd.Output()
	behind := "0"
	if err == nil {
		behind = strings.TrimSpace(string(out))
	}

	cmd = svc.NewHiddenCommand("git", "log", "gitee/main", "--oneline", "-5")
	cmd.Dir = s.rootDir
	out, _ = cmd.Output()

	writeJSON(w, http.StatusOK, map[string]any{
		"hasUpdate":  behind != "0",
		"behind":     behind,
		"recentLogs": strings.TrimSpace(string(out)),
	})
}

func (s *Server) handleUpdateApply(w http.ResponseWriter, r *http.Request) {
	cmd := svc.NewHiddenCommand("git", "pull", "gitee", "main")
	cmd.Dir = s.rootDir
	if out, err := cmd.CombinedOutput(); err != nil {
		writeError(w, http.StatusInternalServerError, "git pull: "+string(out))
		return
	}

	s.mgr.Log("system", "Git pull completed. Restart launcher to apply all changes.")
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *Server) handleUpdateDeps(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	results, err := s.mgr.UpdateDeps(name)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{
			"results": results,
			"error":   err.Error(),
		})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"results": results})
}

