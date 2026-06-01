package api

import (
	"fmt"
	"net/http"
	"os/exec"
	"strings"
	"time"
)

const githubRemote = "https://github.com/gfjdh/satori-ai"

type updateStatus struct {
	HasUpdate bool     `json:"hasUpdate"`
	Current   string   `json:"current"`
	Latest    string   `json:"latest"`
	Commits   []string `json:"commits"`
	LastCheck string   `json:"lastCheck"`
}

func (s *Server) handleUpdateCheck(w http.ResponseWriter, r *http.Request) {
	root := s.mgr.RootDir()

	// Ensure remote is set to the GitHub repo
	ensureRemote(root)

	// git fetch
	fetch := exec.Command("git", "fetch", "origin")
	fetch.Dir = root
	if out, err := fetch.CombinedOutput(); err != nil {
		writeJSON(w, map[string]string{"error": fmt.Sprintf("git fetch failed: %s", string(out))})
		return
	}

	current := gitRevParse(root, "HEAD")
	latest := gitRevParse(root, "origin/main")
	commits := gitLog(root, "HEAD..origin/main")

	status := updateStatus{
		HasUpdate: current != latest && len(commits) > 0,
		Current:   current,
		Latest:    latest,
		Commits:   commits,
		LastCheck: time.Now().Format("2006-01-02 15:04:05"),
	}
	writeJSON(w, status)
}

func ensureRemote(root string) {
	// Check if origin remote exists
	check := exec.Command("git", "remote", "get-url", "origin")
	check.Dir = root
	out, err := check.Output()
	if err == nil && strings.TrimSpace(string(out)) == githubRemote {
		return
	}

	if err != nil {
		// No origin remote — add it
		add := exec.Command("git", "remote", "add", "origin", githubRemote)
		add.Dir = root
		add.Run()
	} else {
		// Origin exists but wrong URL — fix it
		set := exec.Command("git", "remote", "set-url", "origin", githubRemote)
		set.Dir = root
		set.Run()
	}
}

func (s *Server) handleUpdateApply(w http.ResponseWriter, r *http.Request) {
	root := s.mgr.RootDir()
	ensureRemote(root)

	pull := exec.Command("git", "pull", "origin", "main")
	pull.Dir = root
	out, err := pull.CombinedOutput()
	if err != nil {
		writeJSON(w, map[string]string{"error": fmt.Sprintf("git pull failed: %s", string(out))})
		return
	}
	writeJSON(w, map[string]string{"status": "ok", "output": strings.TrimSpace(string(out))})
}

func (s *Server) handleUpdateDeps(w http.ResponseWriter, r *http.Request) {
	root := s.mgr.RootDir()
	var results []string

	npmRoot := exec.Command("npm", "install")
	npmRoot.Dir = root
	if out, err := npmRoot.CombinedOutput(); err != nil {
		results = append(results, fmt.Sprintf("root npm install FAILED: %s", string(out)))
	} else {
		results = append(results, "root npm install OK")
	}

	npmWebUI := exec.Command("npm", "install")
	npmWebUI.Dir = root + `\webui`
	if out, err := npmWebUI.CombinedOutput(); err != nil {
		results = append(results, fmt.Sprintf("webui npm install FAILED: %s", string(out)))
	} else {
		results = append(results, "webui npm install OK")
	}

	pipServices := []string{"tts", "embedding", "image", "browser", "asr"}
	for _, svcName := range pipServices {
		venvPip := root + `\services\` + svcName + `\venv\Scripts\pip.exe`
		reqFile := root + `\services\` + svcName + `\requirements.txt`
		pip := exec.Command(venvPip, "install", "-r", reqFile)
		if out, err := pip.CombinedOutput(); err != nil {
			results = append(results, fmt.Sprintf("%s pip install FAILED: %s", svcName, string(out)))
		} else {
			results = append(results, fmt.Sprintf("%s pip install OK", svcName))
		}
	}

	writeJSON(w, map[string]interface{}{"results": results})
}

func (s *Server) handleServiceUpdateDeps(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	results, err := s.mgr.UpdateDeps(name)
	if err != nil {
		writeJSON(w, map[string]interface{}{"results": results, "error": err.Error()})
		return
	}
	writeJSON(w, map[string]interface{}{"results": results})
}

func gitRevParse(dir, ref string) string {
	cmd := exec.Command("git", "rev-parse", "--short", ref)
	cmd.Dir = dir
	out, err := cmd.Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(out))
}

func gitLog(dir, refRange string) []string {
	cmd := exec.Command("git", "log", "--oneline", refRange)
	cmd.Dir = dir
	out, err := cmd.Output()
	if err != nil {
		return nil
	}
	lines := strings.Split(strings.TrimSpace(string(out)), "\n")
	if len(lines) == 1 && lines[0] == "" {
		return nil
	}
	return lines
}
