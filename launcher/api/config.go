package api

import (
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

type llmEntry struct {
	URL   string `json:"url"`
	Key   string `json:"key"`
	Model string `json:"model"`
}

type llmConfig struct {
	LLM  llmEntry `json:"llm"`
	VLLM llmEntry `json:"vllm"`
}

func (s *Server) handleConfigGet(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, readLLMConfig(s.rootDir))
}

func (s *Server) handleConfigPost(w http.ResponseWriter, r *http.Request) {
	var body llmConfig
	if err := decodeBody(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}

	envPath := filepath.Join(s.rootDir, ".env")
	prevLines := readRawEnvLines(envPath)
	existing := parseEnvLines(prevLines)

	// Merge LLM fields
	existing["LLM_BASE_URL"] = body.LLM.URL
	existing["LLM_API_KEY"] = body.LLM.Key
	existing["LLM_MODEL"] = body.LLM.Model
	existing["VISION_LLM_BASE_URL"] = body.VLLM.URL
	existing["VISION_LLM_API_KEY"] = body.VLLM.Key
	existing["VISION_LLM_MODEL"] = body.VLLM.Model

	llmKeys := map[string]bool{
		"LLM_BASE_URL": true, "LLM_API_KEY": true, "LLM_MODEL": true,
		"VISION_LLM_BASE_URL": true, "VISION_LLM_API_KEY": true, "VISION_LLM_MODEL": true,
	}

	var out []string
	seen := make(map[string]bool)
	for _, line := range prevLines {
		kv := strings.SplitN(line, "=", 2)
		if len(kv) == 2 {
			key := strings.TrimSpace(kv[0])
			if llmKeys[key] {
				if !seen[key] {
					out = append(out, key+"="+existing[key])
					seen[key] = true
				}
			} else {
				out = append(out, line)
			}
		} else {
			out = append(out, line)
		}
	}
	for _, key := range []string{"LLM_BASE_URL", "LLM_API_KEY", "LLM_MODEL", "VISION_LLM_BASE_URL", "VISION_LLM_API_KEY", "VISION_LLM_MODEL"} {
		if !seen[key] {
			out = append(out, key+"="+existing[key])
		}
	}

	if err := os.WriteFile(envPath, []byte(strings.Join(out, "\n")+"\n"), 0644); err != nil {
		writeError(w, http.StatusInternalServerError, "write .env: "+err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *Server) handleShutdown(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "shutting down"})
	go func() {
		s.mgr.StopAll()
		os.Exit(0)
	}()
}

func readLLMConfig(rootDir string) llmConfig {
	envPath := filepath.Join(rootDir, ".env")
	lines := readRawEnvLines(envPath)
	if len(lines) == 0 {
		examplePath := filepath.Join(rootDir, ".env.example")
		lines = readRawEnvLines(examplePath)
	}
	kv := parseEnvLines(lines)
	return llmConfig{
		LLM:  llmEntry{URL: kv["LLM_BASE_URL"], Key: kv["LLM_API_KEY"], Model: kv["LLM_MODEL"]},
		VLLM: llmEntry{URL: kv["VISION_LLM_BASE_URL"], Key: kv["VISION_LLM_API_KEY"], Model: kv["VISION_LLM_MODEL"]},
	}
}

func readRawEnvLines(path string) []string {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil
	}
	return strings.Split(string(data), "\n")
}

func parseEnvLines(lines []string) map[string]string {
	result := make(map[string]string)
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		kv := strings.SplitN(line, "=", 2)
		if len(kv) == 2 {
			result[strings.TrimSpace(kv[0])] = strings.TrimSpace(kv[1])
		}
	}
	return result
}
