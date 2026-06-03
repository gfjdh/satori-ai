package svc

import (
	"bufio"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

type ServiceStatus string

const (
	StatusRunning ServiceStatus = "running"
	StatusStopped ServiceStatus = "stopped"
	StatusError   ServiceStatus = "error"
)

var ErrAlreadyRunning = errors.New("service already running")

type ServiceInfo struct {
	Name       string        `json:"name"`
	Port       int           `json:"port"`
	Status     ServiceStatus `json:"status"`
	PID        int           `json:"pid,omitempty"`
	Uptime     string        `json:"uptime,omitempty"`
	Cmd        string        `json:"cmd"`
	WorkDir    string        `json:"workDir"`
	StartOrder int           `json:"startOrder"`
}

type LogEntry struct {
	Time    string `json:"time"`
	Service string `json:"service"`
	Line    string `json:"line"`
}

type serviceDef struct {
	Name     string
	Port     int
	Cmd      string
	WorkDir  string
	Shell    string
	ShellArg string

	StartOrder     int
	MinPythonMinor int
	MaxPythonMinor int
	DepsType       string
	DepsWorkDir    string
}

func (d *serviceDef) pythonRequirement() string {
	if d.MinPythonMinor == 0 && d.MaxPythonMinor == 0 {
		return ""
	}
	if d.MinPythonMinor == d.MaxPythonMinor {
		return fmt.Sprintf("Python 3.%d", d.MinPythonMinor)
	}
	return fmt.Sprintf("Python 3.%d - 3.%d", d.MinPythonMinor, d.MaxPythonMinor)
}

var serviceDefs = []serviceDef{
	{Name: "TTS", Port: 5030, Cmd: `venv\Scripts\python.exe app.py`, WorkDir: `services\tts`, Shell: "cmd", ShellArg: "/c", StartOrder: 10, MinPythonMinor: 12, MaxPythonMinor: 13, DepsType: "pip", DepsWorkDir: `services\tts`},
	{Name: "Embedding", Port: 7860, Cmd: `venv\Scripts\python.exe -m uvicorn main:app --host 0.0.0.0 --port 7860`, WorkDir: `services\embedding`, Shell: "cmd", ShellArg: "/c", StartOrder: 20, MinPythonMinor: 12, MaxPythonMinor: 13, DepsType: "pip", DepsWorkDir: `services\embedding`},
	{Name: "Image", Port: 8742, Cmd: `venv\Scripts\python.exe -m uvicorn app:app --host 0.0.0.0 --port 8742`, WorkDir: `services\image`, Shell: "cmd", ShellArg: "/c", StartOrder: 30, MinPythonMinor: 12, MaxPythonMinor: 13, DepsType: "pip", DepsWorkDir: `services\image`},
	{Name: "Browser", Port: 8743, Cmd: `venv\Scripts\python.exe server.py`, WorkDir: `services\browser`, Shell: "cmd", ShellArg: "/c", StartOrder: 40, MinPythonMinor: 12, MaxPythonMinor: 13, DepsType: "pip", DepsWorkDir: `services\browser`},
	{Name: "ASR", Port: 5032, Cmd: `venv\Scripts\python.exe app.py`, WorkDir: `services\asr`, Shell: "cmd", ShellArg: "/c", StartOrder: 50, MinPythonMinor: 12, MaxPythonMinor: 12, DepsType: "pip", DepsWorkDir: `services\asr`},
	{Name: "WebUI", Port: 5173, Cmd: "node serve.cjs", WorkDir: "webui", Shell: "cmd", ShellArg: "/c", StartOrder: 60},
	{Name: "Backend", Port: 3682, Cmd: "node dist/index.js", WorkDir: ".", Shell: "cmd", ShellArg: "/c", StartOrder: 70},
	{Name: "Live2D", Port: 0, Cmd: `pythonw.exe live2d-launcher.py`, WorkDir: `live2d-widget`, Shell: "cmd", ShellArg: "/c", StartOrder: 80},
}

type Manager struct {
	mu       sync.Mutex
	services map[string]*runningService
	logCh    chan LogEntry
	rootDir  string
}

type runningService struct {
	cmd     *exec.Cmd
	info    ServiceInfo
	started time.Time
}

func NewManager(rootDir string) *Manager {
	return &Manager{
		services: make(map[string]*runningService),
		logCh:    make(chan LogEntry, 1000),
		rootDir:  rootDir,
	}
}

func (m *Manager) RootDir() string           { return m.rootDir }
func (m *Manager) LogChannel() <-chan LogEntry { return m.logCh }

func (m *Manager) Log(service, line string) {
	m.logCh <- LogEntry{Time: time.Now().Format("15:04:05"), Service: service, Line: line}
}

func (m *Manager) AllServices() []ServiceInfo {
	m.mu.Lock()
	defer m.mu.Unlock()

	result := make([]ServiceInfo, 0)
	for _, def := range serviceDefs {
		if rs, ok := m.services[def.Name]; ok {
			result = append(result, rs.info)
		} else {
			result = append(result, ServiceInfo{
				Name:       def.Name,
				Port:       def.Port,
				Status:     StatusStopped,
				Cmd:        def.Cmd,
				WorkDir:    def.WorkDir,
				StartOrder: def.StartOrder,
			})
		}
	}
	sort.Slice(result, func(i, j int) bool {
		return result[i].StartOrder < result[j].StartOrder
	})
	return result
}

func (m *Manager) Start(name string) error {
	m.mu.Lock()

	if rs, ok := m.services[name]; ok && isAlive(rs.cmd) {
		m.mu.Unlock()
		return fmt.Errorf("%s: %w", name, ErrAlreadyRunning)
	}

	def := findServiceDef(name)
	if def == nil {
		m.mu.Unlock()
		return fmt.Errorf("unknown service: %s", name)
	}

	// Clean up any orphan process on the target port before starting
	if def.Port > 0 {
		killPortOccupant(def.Port)
	}

	cmd := NewHiddenCommand(def.Shell, def.ShellArg, def.Cmd)
	cmd.Dir = filepath.Join(m.rootDir, def.WorkDir)

	// Set PYTHONHOME for Python venv-based services
	if strings.Contains(def.Cmd, "venv") && strings.Contains(def.Cmd, "python") {
		venvDir := filepath.Join(m.rootDir, def.WorkDir, "venv")
		if _, err := os.Stat(filepath.Join(venvDir, "pyvenv.cfg")); err == nil {
			setPythonHomeEnv(cmd, venvDir)
		}
	}

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		m.mu.Unlock()
		return fmt.Errorf("stdout pipe: %w", err)
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		m.mu.Unlock()
		return fmt.Errorf("stderr pipe: %w", err)
	}

	if err := cmd.Start(); err != nil {
		m.mu.Unlock()
		m.logCh <- LogEntry{time.Now().Format("15:04:05"), name, fmt.Sprintf("ERROR: %v", err)}
		return err
	}
	// Assign child process to global Job Object so the OS kills it when we exit
	assignToJob(cmd.Process.Pid)

	rs := &runningService{
		cmd:     cmd,
		started: time.Now(),
		info: ServiceInfo{
			Name:       name,
			Port:       def.Port,
			Status:     StatusRunning,
			PID:        cmd.Process.Pid,
			Cmd:        def.Cmd,
			WorkDir:    def.WorkDir,
			StartOrder: def.StartOrder,
		},
	}
	m.services[name] = rs
	m.mu.Unlock()

	go m.streamLogs(name, stdout)
	go m.streamLogs(name, stderr)
	m.logCh <- LogEntry{time.Now().Format("15:04:05"), name, fmt.Sprintf("started (PID: %d)", cmd.Process.Pid)}

	go func() {
		err := cmd.Wait()
		m.mu.Lock()
		defer m.mu.Unlock()
		status := StatusStopped
		if err != nil {
			status = StatusError
			m.logCh <- LogEntry{time.Now().Format("15:04:05"), name, fmt.Sprintf("exited with error: %v", err)}
		} else {
			m.logCh <- LogEntry{time.Now().Format("15:04:05"), name, "stopped"}
		}
		if rs, ok := m.services[name]; ok {
			rs.info.Status = status
		}
	}()

	return nil
}

func (m *Manager) Stop(name string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	rs, ok := m.services[name]
	if !ok {
		return fmt.Errorf("%s is not running", name)
	}

	if err := killProcess(rs.cmd); err != nil {
		return err
	}

	delete(m.services, name)
	m.logCh <- LogEntry{time.Now().Format("15:04:05"), name, "stopped by user"}
	return nil
}

func (m *Manager) StartAll() []error {
	ordered := make([]serviceDef, len(serviceDefs))
	copy(ordered, serviceDefs)
	sort.Slice(ordered, func(i, j int) bool {
		return ordered[i].StartOrder < ordered[j].StartOrder
	})

	var errs []error
	for i, def := range ordered {
		m.mu.Lock()
		_, running := m.services[def.Name]
		m.mu.Unlock()
		if running {
			m.logCh <- LogEntry{time.Now().Format("15:04:05"), def.Name, "already running, skipping"}
			continue
		}

		m.logCh <- LogEntry{time.Now().Format("15:04:05"), "system",
			fmt.Sprintf("starting %s (%d/%d)...", def.Name, i+1, len(ordered))}

		if err := m.Start(def.Name); err != nil {
			if errors.Is(err, ErrAlreadyRunning) {
				continue
			}
			errs = append(errs, err)
			m.logCh <- LogEntry{time.Now().Format("15:04:05"), "system",
				fmt.Sprintf("FAILED to start %s: %v", def.Name, err)}
			continue
		}

		if i < len(ordered)-1 {
			time.Sleep(3 * time.Second)
		}
	}
	return errs
}

func (m *Manager) StopAll() []error {
	m.mu.Lock()
	defer m.mu.Unlock()

	var errs []error
	for name, rs := range m.services {
		if err := killProcess(rs.cmd); err != nil {
			errs = append(errs, err)
		}
		// Port-based fallback kill for stubborn processes
		def := findServiceDef(name)
		if def != nil && def.Port > 0 {
			killPortOccupant(def.Port)
		}
		delete(m.services, name)
	}
	m.logCh <- LogEntry{time.Now().Format("15:04:05"), "system", "all services stopped"}
	return errs
}

func (m *Manager) InitEnvironment(names ...string) []LogEntry {
	var logs []LogEntry
	emit := func(service, line string) {
		entry := LogEntry{time.Now().Format("15:04:05"), service, line}
		logs = append(logs, entry)
		m.logCh <- entry
	}

	// Build filter set — if empty, init all with deps
	filter := make(map[string]bool)
	if len(names) > 0 {
		for _, n := range names {
			filter[n] = true
		}
	}

	emit("system", "Initializing environment...")
	startTime := time.Now()

	// Find best Python for general microservices (3.12-3.13)
	generalPy, err := FindBestPython(m.rootDir, 12, 13)
	if err != nil {
		emit("system", fmt.Sprintf("FATAL: %v", err))
		return logs
	}
	emit("system", fmt.Sprintf("Using Python: %s", generalPy))

	// Create venvs and install pip deps for selected Python microservices
	for _, def := range serviceDefs {
		if def.DepsType != "pip" {
			continue
		}
		if len(filter) > 0 && !filter[def.Name] {
			emit(def.Name, "skipped")
			continue
		}

		venvDir := filepath.Join(m.rootDir, def.DepsWorkDir, "venv")
		pythonPath := generalPy
		if def.MinPythonMinor == def.MaxPythonMinor {
			if p, err := FindBestPython(m.rootDir, def.MinPythonMinor, def.MaxPythonMinor); err == nil {
				pythonPath = p
			}
		}

		if _, err := os.Stat(filepath.Join(venvDir, "Scripts", "python.exe")); err != nil {
			emit(def.Name, fmt.Sprintf("creating venv with %s...", filepath.Base(pythonPath)))
			venvCmd, venvCancel := NewHiddenCommandTimeout(3*time.Minute, pythonPath, "-m", "virtualenv", venvDir)
			venvCmd.Env = append(venvCmd.Environ(), "PYTHONHOME="+filepath.Dir(pythonPath))
			out, err := venvCmd.CombinedOutput()
			venvCancel()
			if err != nil {
				emit(def.Name, fmt.Sprintf("venv FAILED: %s", string(out)))
				continue
			}
			emit(def.Name, "venv created")
		}

		pipExe := filepath.Join(venvDir, "Scripts", "pip.exe")
		reqFile := filepath.Join(m.rootDir, def.DepsWorkDir, "requirements.txt")
		emit(def.Name, fmt.Sprintf("pip install -r %s...", reqFile))
		pipCmd, pipCancel := NewPipCommandTimeout(15*time.Minute, pipExe, "install", "-r", reqFile, "--find-links", filepath.Join(m.rootDir, "wheels"))
		setPythonHomeEnv(pipCmd, venvDir)
		out, err := pipCmd.CombinedOutput()
		pipCancel()
		if err != nil {
			emit(def.Name, fmt.Sprintf("pip install FAILED: %s", string(out)))
			continue
		}
		emit(def.Name, "pip install OK")
	}

	emit("system", fmt.Sprintf("environment initialization complete (took %v)", time.Since(startTime).Round(time.Second)))
	return logs
}

func (m *Manager) UpdateDeps(name string) ([]string, error) {
	def := findServiceDef(name)
	if def == nil {
		return nil, fmt.Errorf("unknown service: %s", name)
	}
	if def.DepsType == "" {
		return []string{fmt.Sprintf("%s has no dependency manager", name)}, nil
	}

	m.logCh <- LogEntry{time.Now().Format("15:04:05"), name, "updating dependencies..."}
	startTime := time.Now()
	var results []string

	switch def.DepsType {
	case "npm":
		npmDir := filepath.Join(m.rootDir, def.DepsWorkDir)
		npmCmd := NewNpmCommand("install")
		npmCmd.Dir = npmDir
		out, err := npmCmd.CombinedOutput()
		if err != nil {
			msg := fmt.Sprintf("%s npm install FAILED: %s", name, string(out))
			results = append(results, msg)
			m.logCh <- LogEntry{time.Now().Format("15:04:05"), name, msg}
			return results, err
		}
		results = append(results, fmt.Sprintf("%s npm install OK", name))

	case "pip":
		venvDir := filepath.Join(m.rootDir, def.DepsWorkDir, "venv")
		pipExe := filepath.Join(venvDir, "Scripts", "pip.exe")

		if _, err := os.Stat(pipExe); err != nil {
			pythonPath, err := FindBestPython(m.rootDir, def.MinPythonMinor, def.MaxPythonMinor)
			if err != nil {
				msg := fmt.Sprintf("%s needs Python %s but not found", name, def.pythonRequirement())
				results = append(results, msg)
				m.logCh <- LogEntry{time.Now().Format("15:04:05"), name, msg}
				return results, fmt.Errorf("%s: %w", msg, err)
			}
			venvCmd, venvCancel := NewHiddenCommandTimeout(3*time.Minute, pythonPath, "-m", "virtualenv", venvDir)
			venvCmd.Env = append(venvCmd.Environ(), "PYTHONHOME="+filepath.Dir(pythonPath))
			out, err := venvCmd.CombinedOutput()
			venvCancel()
			if err != nil {
				msg := fmt.Sprintf("%s venv creation FAILED: %s", name, string(out))
				results = append(results, msg)
				m.logCh <- LogEntry{time.Now().Format("15:04:05"), name, msg}
				return results, err
			}
		}

		reqFile := filepath.Join(m.rootDir, def.DepsWorkDir, "requirements.txt")
		pipCmd, pipCancel := NewPipCommandTimeout(15*time.Minute, pipExe, "install", "-r", reqFile, "--find-links", filepath.Join(m.rootDir, "wheels"))
		setPythonHomeEnv(pipCmd, venvDir)
		out, err := pipCmd.CombinedOutput()
		pipCancel()
		if err != nil {
			msg := fmt.Sprintf("%s pip install FAILED: %s", name, string(out))
			results = append(results, msg)
			m.logCh <- LogEntry{time.Now().Format("15:04:05"), name, msg}
			return results, err
		}
		results = append(results, fmt.Sprintf("%s pip install OK", name))
	}

	m.logCh <- LogEntry{time.Now().Format("15:04:05"), name,
		fmt.Sprintf("dependencies updated (took %v)", time.Since(startTime).Round(time.Second))}
	return results, nil
}

func (m *Manager) streamLogs(service string, r io.Reader) {
	scanner := bufio.NewScanner(r)
	for scanner.Scan() {
		m.logCh <- LogEntry{
			Time:    time.Now().Format("15:04:05"),
			Service: service,
			Line:    scanner.Text(),
		}
	}
}

func findServiceDef(name string) *serviceDef {
	for i := range serviceDefs {
		if serviceDefs[i].Name == name {
			return &serviceDefs[i]
		}
	}
	return nil
}

func isAlive(cmd *exec.Cmd) bool {
	if cmd.Process == nil {
		return false
	}
	out, err := NewHiddenCommand("tasklist", "/FI", "PID eq "+strconv.Itoa(cmd.Process.Pid), "/NH").Output()
	if err != nil {
		return false
	}
	return len(out) > 0 && out[0] != 'I'
}

// setPythonHomeEnv reads the venv's pyvenv.cfg to find the base Python home
// directory and sets PYTHONHOME on the command. This prevents embedded Python
// from leaking system Python paths (registry/baked-in) that cause DLL mismatches
// and segfaults, while preserving CWD in sys.path[0] (unlike a ._pth file).
func setPythonHomeEnv(cmd *exec.Cmd, venvDir string) {
	cfg, err := os.ReadFile(filepath.Join(venvDir, "pyvenv.cfg"))
	if err != nil {
		return
	}
	for _, line := range strings.Split(string(cfg), "\n") {
		if strings.HasPrefix(line, "home = ") {
			home := strings.TrimSpace(strings.TrimPrefix(line, "home = "))
			cmd.Env = append(cmd.Environ(), "PYTHONHOME="+home)
			return
		}
	}
}

func killProcess(cmd *exec.Cmd) error {
	if cmd.Process == nil {
		return nil
	}
	treeKill := NewHiddenCommand("taskkill", "/F", "/T", "/PID", strconv.Itoa(cmd.Process.Pid))
	treeKill.Stdout = nil
	treeKill.Stderr = nil
	return treeKill.Run()
}
