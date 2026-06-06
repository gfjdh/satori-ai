package api

import (
	"bufio"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

var llmKeys = map[string]bool{
	"LLM_API_KEY":        true,
	"LLM_BASE_URL":       true,
	"LLM_MODEL":          true,
	"LLM_TEMPERATURE":    true,
	"VISION_LLM_API_KEY": true,
	"VISION_LLM_BASE_URL": true,
	"VISION_LLM_MODEL":   true,
	"VISION_LLM_TEMPERATURE": true,
}

func (s *Server) handleConfig(w http.ResponseWriter, r *http.Request) {
	envPath := filepath.Join(s.rootDir, ".env")

	switch r.Method {
	case http.MethodGet:
		config := s.readConfig(envPath)
		jsonOK(w, config)

	case http.MethodPost:
		var input map[string]string
		if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
			jsonError(w, "invalid JSON: "+err.Error(), http.StatusBadRequest)
			return
		}
		if err := s.writeConfig(envPath, input); err != nil {
			jsonError(w, "write config failed: "+err.Error(), http.StatusInternalServerError)
			return
		}
		jsonOK(w, map[string]string{"status": "ok"})

	default:
		jsonError(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func (s *Server) readConfig(envPath string) map[string]string {
	result := make(map[string]string)
	for k := range llmKeys {
		result[k] = ""
	}

	f, err := os.Open(envPath)
	if err != nil {
		return result
	}
	defer f.Close()

	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		parts := strings.SplitN(line, "=", 2)
		if len(parts) != 2 {
			continue
		}
		key := strings.TrimSpace(parts[0])
		if llmKeys[key] {
			result[key] = strings.TrimSpace(parts[1])
		}
	}
	return result
}

func (s *Server) writeConfig(envPath string, input map[string]string) error {
	examplePath := filepath.Join(s.rootDir, ".env.example")

	// read existing .env or .env.example as template
	var lines []string
	f, err := os.Open(envPath)
	if err != nil {
		// .env doesn't exist, try .env.example
		f, err = os.Open(examplePath)
		if err != nil {
			// neither exists, create from input
			for k, v := range input {
				if v != "" {
					lines = append(lines, k+"="+v)
				}
			}
			return os.WriteFile(envPath, []byte(strings.Join(lines, "\n")+"\n"), 0644)
		}
	}
	if f != nil {
		defer f.Close()
		scanner := bufio.NewScanner(f)
		seen := make(map[string]bool)
		for scanner.Scan() {
			line := strings.TrimSpace(scanner.Text())
			if line == "" || strings.HasPrefix(line, "#") {
				lines = append(lines, line)
				continue
			}
			parts := strings.SplitN(line, "=", 2)
			if len(parts) != 2 {
				lines = append(lines, line)
				continue
			}
			key := strings.TrimSpace(parts[0])
			if llmKeys[key] {
				if val, ok := input[key]; ok && val != "" {
					lines = append(lines, key+"="+val)
					seen[key] = true
				} else {
					lines = append(lines, line) // keep existing
					seen[key] = true
				}
			} else {
				lines = append(lines, line) // keep non-LLM lines intact
			}
		}
		// append LLM keys not seen yet
		for k, v := range input {
			if !seen[k] && v != "" {
				lines = append(lines, k+"="+v)
			}
		}
	}

	return os.WriteFile(envPath, []byte(strings.Join(lines, "\n")+"\n"), 0644)
}
