package svc

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"sync"
	"time"
)

type ServiceStatus string

const (
	StatusNotInstalled ServiceStatus = "not_installed"
	StatusStopped      ServiceStatus = "stopped"
	StatusStarting     ServiceStatus = "starting"
	StatusRunning      ServiceStatus = "running"
	StatusError        ServiceStatus = "error"
)

type ServiceDef struct {
	Name          string `json:"name"`
	Port          int    `json:"port"`
	SetupScript   string `json:"-"`
	StartScript   string `json:"-"`
	StartOrder    int    `json:"-"`
	SetupSentinel string `json:"-"`
	RuntimeLabel  string `json:"runtime"`
}

type ServiceState struct {
	ServiceDef
	Status ServiceStatus `json:"status"`
	PID    int           `json:"pid"`
}

type Manager struct {
	rootDir string
	svcDefs []ServiceDef
	states  map[string]*ServiceState
	mu      sync.RWMutex
}

func NewManager(rootDir string) *Manager {
	m := &Manager{
		rootDir: rootDir,
		states:  make(map[string]*ServiceState),
		svcDefs: []ServiceDef{
			{Name: "Embedding", Port: 7860, SetupScript: "script/embedding-setup.bat", StartScript: "script/embedding-start.bat", StartOrder: 1, SetupSentinel: "services/embedding/.setup_done", RuntimeLabel: "Python 3.13"},
			{Name: "TTS", Port: 5030, SetupScript: "script/tts-setup.bat", StartScript: "script/tts-start.bat", StartOrder: 2, SetupSentinel: "services/tts/.setup_done", RuntimeLabel: "Python 3.13"},
			{Name: "ASR", Port: 5032, SetupScript: "script/asr-setup.bat", StartScript: "script/asr-start.bat", StartOrder: 3, SetupSentinel: "services/asr/.setup_done", RuntimeLabel: "Python 3.12"},
			{Name: "Image", Port: 8742, SetupScript: "script/image-setup.bat", StartScript: "script/image-start.bat", StartOrder: 4, SetupSentinel: "services/image/.setup_done", RuntimeLabel: "Python 3.13"},
			{Name: "Browser", Port: 8743, SetupScript: "script/browser-setup.bat", StartScript: "script/browser-start.bat", StartOrder: 5, SetupSentinel: "services/browser/.setup_done", RuntimeLabel: "Python 3.13"},
			{Name: "Backend", Port: 3682, SetupScript: "script/backend-setup.bat", StartScript: "script/backend-start.bat", StartOrder: 6, SetupSentinel: "dist/.setup_done", RuntimeLabel: "Node.js"},
			{Name: "WebUI", Port: 5173, SetupScript: "script/webui-setup.bat", StartScript: "script/webui-start.bat", StartOrder: 7, SetupSentinel: "webui/.setup_done", RuntimeLabel: "Node.js"},
			{Name: "Live2D", Port: 0, SetupScript: "script/live2d-setup.bat", StartScript: "script/live2d-start.bat", StartOrder: 8, SetupSentinel: "live2d-widget/.setup_done", RuntimeLabel: "Python 3.13"},
		},
	}
	for i := range m.svcDefs {
		m.states[m.svcDefs[i].Name] = &ServiceState{
			ServiceDef: m.svcDefs[i],
			Status:     StatusNotInstalled,
		}
	}
	return m
}

// --- Public API ---

func (m *Manager) RefreshAll() {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, def := range m.svcDefs {
		state := m.states[def.Name]
		sentinel := filepath.Join(m.rootDir, def.SetupSentinel)
		if _, err := os.Stat(sentinel); os.IsNotExist(err) {
			state.Status = StatusNotInstalled
			state.PID = 0
			continue
		}
		if state.PID != 0 && ProcessExists(state.PID) {
			if def.Port > 0 && m.checkHealth(def.Port) {
				state.Status = StatusRunning
			} else if def.Port == 0 {
				state.Status = StatusRunning
			} else {
				state.Status = StatusStarting
			}
		} else {
			state.Status = StatusStopped
			state.PID = 0
		}
	}
}

func (m *Manager) GetStates() []ServiceState {
	m.mu.RLock()
	defer m.mu.RUnlock()
	result := make([]ServiceState, 0, len(m.svcDefs))
	for _, def := range m.svcDefs {
		state := *m.states[def.Name]
		result = append(result, state)
	}
	return result
}

func (m *Manager) GetState(name string) *ServiceState {
	m.mu.RLock()
	defer m.mu.RUnlock()
	if s, ok := m.states[name]; ok {
		cp := *s
		return &cp
	}
	return nil
}

func (m *Manager) Setup(name string) error {
	def := m.findDef(name)
	if def == nil {
		return fmt.Errorf("unknown service: %s", name)
	}

	m.setStatus(name, StatusStarting)
	LogService(name, "setup started")

	cmd, err := m.runScriptSync(name, def.SetupScript)
	if err != nil {
		m.setStatus(name, StatusError)
		LogService(name, "setup failed: %v", err)
		return err
	}

	if cmd.ProcessState != nil && !cmd.ProcessState.Success() {
		m.setStatus(name, StatusError)
		LogService(name, "setup script exited with error")
		return fmt.Errorf("setup script failed for %s", name)
	}

	m.setStatus(name, StatusStopped)
	LogService(name, "setup complete")
	return nil
}

func (m *Manager) Start(name string) error {
	def := m.findDef(name)
	if def == nil {
		return fmt.Errorf("unknown service: %s", name)
	}

	if def.Port > 0 {
		KillPortOccupant(def.Port)
	}

	m.setStatus(name, StatusStarting)
	LogService(name, "starting")

	cmd, err := m.runScriptAsync(name, def.StartScript)
	if err != nil {
		m.setStatus(name, StatusError)
		LogService(name, "start failed: %v", err)
		return err
	}

	pid := cmd.Process.Pid
	m.setPID(name, pid)
	if err := assignToJob(pid); err != nil {
		LogError("assignToJob(%s, pid=%d) failed: %v", name, pid, err)
	}

	if def.Port > 0 {
		LogService(name, "waiting for health check on port %d", def.Port)
		if m.pollHealth(def.Port, 60*time.Second, 2*time.Second) {
			m.setStatus(name, StatusRunning)
			LogService(name, "healthy on port %d", def.Port)
		} else {
			LogService(name, "health check timeout on port %d", def.Port)
		}
	} else {
		time.Sleep(2 * time.Second)
		if ProcessExists(pid) {
			m.setStatus(name, StatusRunning)
		}
		LogService(name, "GUI started")
	}

	return nil
}

func (m *Manager) StartAll() []string {
	var errors []string
	ordered := make([]ServiceDef, len(m.svcDefs))
	copy(ordered, m.svcDefs)
	sort.Slice(ordered, func(i, j int) bool { return ordered[i].StartOrder < ordered[j].StartOrder })

	for _, def := range ordered {
		state := m.GetState(def.Name)
		if state.Status == StatusRunning {
			LogService(def.Name, "already running, skip")
			continue
		}
		if state.Status == StatusNotInstalled {
			errors = append(errors, fmt.Sprintf("%s: not installed", def.Name))
			continue
		}
		if err := m.Start(def.Name); err != nil {
			errors = append(errors, fmt.Sprintf("%s: %v", def.Name, err))
		}
		if def.StartOrder < 8 {
			time.Sleep(3 * time.Second)
		}
	}
	return errors
}

func (m *Manager) Stop(name string) error {
	def := m.findDef(name)
	if def == nil {
		return fmt.Errorf("unknown service: %s", name)
	}
	if def.Name == "Live2D" {
		return fmt.Errorf("Live2D cannot be stopped individually")
	}

	state := m.GetState(name)
	if state.PID == 0 || !ProcessExists(state.PID) {
		m.setStatus(name, StatusStopped)
		m.setPID(name, 0)
		return nil
	}

	LogService(name, "stopping (pid=%d)", state.PID)
	KillProcess(state.PID)
	if def.Port > 0 {
		KillPortOccupant(def.Port)
	}
	m.setStatus(name, StatusStopped)
	m.setPID(name, 0)
	LogService(name, "stopped")
	return nil
}

func (m *Manager) StopAll() {
	for _, def := range m.svcDefs {
		if def.Name == "Live2D" {
			continue
		}
		m.Stop(def.Name)
	}
	if s := m.GetState("Live2D"); s != nil && s.PID > 0 {
		LogService("Live2D", "stopping")
		KillProcess(s.PID)
		m.setPID("Live2D", 0)
		m.setStatus("Live2D", StatusStopped)
	}
}

func (m *Manager) ForceReinstall(name string) error {
	def := m.findDef(name)
	if def == nil {
		return fmt.Errorf("unknown service: %s", name)
	}
	sentinel := filepath.Join(m.rootDir, def.SetupSentinel)
	os.Remove(sentinel)
	m.setStatus(name, StatusNotInstalled)
	m.setPID(name, 0)
	LogService(name, "sentinel removed, ready for reinstall")
	return nil
}

func (m *Manager) CheckHealthAll() map[string]bool {
	result := make(map[string]bool)
	for _, def := range m.svcDefs {
		if def.Port > 0 {
			result[def.Name] = m.checkHealth(def.Port)
		} else {
			state := m.GetState(def.Name)
			result[def.Name] = state != nil && state.Status == StatusRunning && state.PID > 0 && ProcessExists(state.PID)
		}
	}
	return result
}

// --- Internal ---

func (m *Manager) findDef(name string) *ServiceDef {
	for i := range m.svcDefs {
		if m.svcDefs[i].Name == name {
			return &m.svcDefs[i]
		}
	}
	return nil
}

func (m *Manager) setStatus(name string, status ServiceStatus) {
	m.mu.Lock()
	if s, ok := m.states[name]; ok {
		s.Status = status
	}
	m.mu.Unlock()
}

func (m *Manager) setPID(name string, pid int) {
	m.mu.Lock()
	if s, ok := m.states[name]; ok {
		s.PID = pid
	}
	m.mu.Unlock()
}

func (m *Manager) checkHealth(port int) bool {
	url := fmt.Sprintf("http://127.0.0.1:%d/health", port)
	client := http.Client{Timeout: 3 * time.Second}
	resp, err := client.Get(url)
	if err != nil {
		return false
	}
	resp.Body.Close()
	return resp.StatusCode == 200
}

func (m *Manager) pollHealth(port int, timeout, interval time.Duration) bool {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if m.checkHealth(port) {
			return true
		}
		time.Sleep(interval)
	}
	return false
}

// --- Script Execution ---

// runScriptSync executes a script and blocks until completion, streaming output.
func (m *Manager) runScriptSync(service, scriptPath string) (*exec.Cmd, error) {
	cmd, cancel, stdout, stderr, err := m.executeScript(scriptPath)
	if err != nil {
		return nil, err
	}
	defer cancel()

	var wg sync.WaitGroup
	wg.Add(2)
	go func() { defer wg.Done(); scanLines(service, stdout, "") }()
	go func() { defer wg.Done(); scanLines(service, stderr, "[stderr] ") }()
	wg.Wait()

	cmd.Wait()
	return cmd, nil
}

// runScriptAsync executes a script and returns immediately, streaming output in background.
func (m *Manager) runScriptAsync(service, scriptPath string) (*exec.Cmd, error) {
	cmd, cancel, stdout, stderr, err := m.executeScript(scriptPath)
	if err != nil {
		return nil, err
	}

	go func() {
		defer cancel()
		var wg sync.WaitGroup
		wg.Add(2)
		go func() { defer wg.Done(); scanLines(service, stdout, "") }()
		go func() { defer wg.Done(); scanLines(service, stderr, "[stderr] ") }()
		wg.Wait()
		cmd.Wait()
	}()

	return cmd, nil
}

func (m *Manager) executeScript(scriptPath string) (*exec.Cmd, context.CancelFunc, io.ReadCloser, io.ReadCloser, error) {
	absPath := filepath.Join(m.rootDir, scriptPath)
	if _, err := os.Stat(absPath); os.IsNotExist(err) {
		return nil, nil, nil, nil, fmt.Errorf("script not found: %s", absPath)
	}

	isSetup := filepath.Base(scriptPath)[len(filepath.Base(scriptPath))-9:] == "setup.bat"
	timeout := 5 * time.Minute
	if isSetup {
		timeout = 30 * time.Minute
	}

	cmd, cancel := NewHiddenCommandTimeout(timeout, "cmd", "/c", absPath)
	cmd.Dir = m.rootDir

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		cancel()
		return nil, nil, nil, nil, err
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		cancel()
		return nil, nil, nil, nil, err
	}

	if err := cmd.Start(); err != nil {
		cancel()
		return nil, nil, nil, nil, err
	}

	return cmd, cancel, stdout, stderr, nil
}

func scanLines(service string, r io.Reader, prefix string) {
	scanner := bufio.NewScanner(r)
	scanner.Buffer(make([]byte, 1024*1024), 1024*1024)
	for scanner.Scan() {
		line := scanner.Text()
		if line != "" {
			LogService(service, "%s", prefix+line)
		}
	}
}
