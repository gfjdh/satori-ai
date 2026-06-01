package svc

import (
	"bufio"
	"fmt"
	"io"
	"os/exec"
	"sort"
	"strconv"
	"sync"
	"time"
)

type ServiceStatus string

const (
	StatusRunning ServiceStatus = "running"
	StatusStopped ServiceStatus = "stopped"
	StatusError   ServiceStatus = "error"
)

type ServiceInfo struct {
	Name      string        `json:"name"`
	Port      int           `json:"port"`
	Status    ServiceStatus `json:"status"`
	PID       int           `json:"pid,omitempty"`
	Uptime    string        `json:"uptime,omitempty"`
	Cmd       string        `json:"cmd"`
	WorkDir   string        `json:"workDir"`
	PythonVer string        `json:"pythonVer,omitempty"`
	StartOrder int          `json:"startOrder"`
}

type LogEntry struct {
	Time    string `json:"time"`
	Service string `json:"service"`
	Line    string `json:"line"`
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

func (m *Manager) RootDir() string {
	return m.rootDir
}

func (m *Manager) LogChannel() <-chan LogEntry {
	return m.logCh
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
				PythonVer:  def.pythonRequirement(),
				StartOrder: def.StartOrder,
			})
		}
	}
	// Sort by start order
	sort.Slice(result, func(i, j int) bool {
		return result[i].StartOrder < result[j].StartOrder
	})
	return result
}

func (m *Manager) Start(name string) error {
	m.mu.Lock()

	if rs, ok := m.services[name]; ok {
		if isAlive(rs.cmd) {
			m.mu.Unlock()
			return fmt.Errorf("%s is already running", name)
		}
	}

	def := findServiceDef(name)
	if def == nil {
		m.mu.Unlock()
		return fmt.Errorf("unknown service: %s", name)
	}

	cmd := exec.Command(def.Shell, def.ShellArg, def.Cmd)
	cmd.Dir = m.rootDir + "\\" + def.WorkDir

	stdout, _ := cmd.StdoutPipe()
	stderr, _ := cmd.StderrPipe()

	if err := cmd.Start(); err != nil {
		m.mu.Unlock()
		m.logCh <- LogEntry{time.Now().Format("15:04:05"), name, fmt.Sprintf("ERROR: %v", err)}
		return err
	}

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
			PythonVer:  def.pythonRequirement(),
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

// StartAll starts services sequentially in order: microservices → WebUI → Backend → Live2D.
// Each service gets a 3s gap to avoid CPU contention.
func (m *Manager) StartAll() []error {
	// Sort defs by StartOrder
	ordered := make([]serviceDef, len(serviceDefs))
	copy(ordered, serviceDefs)
	sort.Slice(ordered, func(i, j int) bool {
		return ordered[i].StartOrder < ordered[j].StartOrder
	})

	var errs []error
	for i, def := range ordered {
		// Skip if already running
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
			// If the error is "already running", don't treat as failure
			if err.Error() == def.Name+" is already running" {
				continue
			}
			errs = append(errs, err)
			m.logCh <- LogEntry{time.Now().Format("15:04:05"), "system",
				fmt.Sprintf("FAILED to start %s: %v", def.Name, err)}
			continue
		}

		// Wait between services (except after the last one)
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
		delete(m.services, name)
	}
	m.logCh <- LogEntry{time.Now().Format("15:04:05"), "system", "all services stopped"}
	return errs
}

func (m *Manager) InitEnvironment() []LogEntry {
	m.logCh <- LogEntry{time.Now().Format("15:04:05"), "system", "Initializing environment..."}

	cmd := exec.Command("cmd", "/c", m.rootDir+`\script\00_setup_all.bat`)
	cmd.Dir = m.rootDir

	stdout, _ := cmd.StdoutPipe()
	stderr, _ := cmd.StderrPipe()
	cmd.Start()

	var logs []LogEntry
	scanner := bufio.NewScanner(io.MultiReader(stdout, stderr))
	startTime := time.Now()
	for scanner.Scan() {
		line := scanner.Text()
		entry := LogEntry{time.Now().Format("15:04:05"), "setup", line}
		logs = append(logs, entry)
		m.logCh <- entry
	}

	cmd.Wait()
	m.logCh <- LogEntry{time.Now().Format("15:04:05"), "system",
		fmt.Sprintf("environment initialization complete (took %v)", time.Since(startTime).Round(time.Second))}
	return logs
}

// UpdateDeps updates dependencies for a specific service
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
		npmInstall := exec.Command("npm", "install")
		npmInstall.Dir = m.rootDir + "\\" + def.DepsWorkDir
		out, err := npmInstall.CombinedOutput()
		if err != nil {
			errMsg := fmt.Sprintf("%s npm install FAILED: %s", name, string(out))
			results = append(results, errMsg)
			m.logCh <- LogEntry{time.Now().Format("15:04:05"), name, errMsg}
			return results, err
		}
		results = append(results, fmt.Sprintf("%s npm install OK", name))

	case "pip":
		reqFile := m.rootDir + "\\" + def.DepsWorkDir + "\\requirements.txt"
		pip := exec.Command(m.rootDir+"\\"+def.DepsWorkDir+`\venv\Scripts\pip.exe`, "install", "-r", reqFile)
		out, err := pip.CombinedOutput()
		if err != nil {
			errMsg := fmt.Sprintf("%s pip install FAILED: %s", name, string(out))
			results = append(results, errMsg)
			m.logCh <- LogEntry{time.Now().Format("15:04:05"), name, errMsg}
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

type serviceDef struct {
	Name           string
	Port           int
	Cmd            string
	WorkDir        string
	Shell          string
	ShellArg       string
	StartOrder     int    // lower = started first; sequential in StartAll
	MinPythonMinor int    // minimum Python minor version needed (0 = any)
	MaxPythonMinor int    // maximum Python minor version (0 = no upper bound)
	DepsType       string // "npm", "pip", or "" for none
	DepsWorkDir    string // relative path for dep install (defaults to WorkDir)
}

func (d *serviceDef) pythonRequirement() string {
	if d.MinPythonMinor == 0 && d.MaxPythonMinor == 0 {
		return ""
	}
	if d.MinPythonMinor == d.MaxPythonMinor {
		return fmt.Sprintf("Python 3.%d.x", d.MinPythonMinor)
	}
	if d.MaxPythonMinor > 0 {
		return fmt.Sprintf("Python 3.%d - 3.%d", d.MinPythonMinor, d.MaxPythonMinor)
	}
	return fmt.Sprintf("Python 3.%d+", d.MinPythonMinor)
}

// Start order: microservices (10-50) → WebUI (60) → Backend (70) → Live2D (80)
var serviceDefs = []serviceDef{
	{Name: "TTS",       Port: 5030, Cmd: `venv\Scripts\python.exe app.py`, WorkDir: `services\tts`, Shell: "cmd", ShellArg: "/c", StartOrder: 10, DepsType: "pip", DepsWorkDir: `services\tts`},
	{Name: "Embedding", Port: 7860, Cmd: `venv\Scripts\python.exe -m uvicorn main:app --host 0.0.0.0 --port 7860`, WorkDir: `services\embedding`, Shell: "cmd", ShellArg: "/c", StartOrder: 20, DepsType: "pip", DepsWorkDir: `services\embedding`},
	{Name: "Image",     Port: 8742, Cmd: `venv\Scripts\python.exe -m uvicorn app:app --host 0.0.0.0 --port 8742`, WorkDir: `services\image`, Shell: "cmd", ShellArg: "/c", StartOrder: 30, DepsType: "pip", DepsWorkDir: `services\image`},
	{Name: "Browser",   Port: 8743, Cmd: `venv\Scripts\python.exe server.py`, WorkDir: `services\browser`, Shell: "cmd", ShellArg: "/c", StartOrder: 40, DepsType: "pip", DepsWorkDir: `services\browser`},
	{Name: "ASR",       Port: 5032, Cmd: `venv\Scripts\python.exe app.py`, WorkDir: `services\asr`, Shell: "cmd", ShellArg: "/c", StartOrder: 50, MinPythonMinor: 12, MaxPythonMinor: 12, DepsType: "pip", DepsWorkDir: `services\asr`},
	{Name: "WebUI",     Port: 5173, Cmd: "npm run dev", WorkDir: "webui", Shell: "cmd", ShellArg: "/c", StartOrder: 60, DepsType: "npm", DepsWorkDir: "webui"},
	{Name: "Backend",   Port: 3682, Cmd: "npm run dev", WorkDir: ".", Shell: "cmd", ShellArg: "/c", StartOrder: 70, DepsType: "npm", DepsWorkDir: "."},
	{Name: "Live2D",    Port: 0,    Cmd: `pythonw.exe live2d-launcher.py`, WorkDir: `live2d-widget`, Shell: "cmd", ShellArg: "/c", StartOrder: 80},
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
	out, err := exec.Command("tasklist", "/FI", "PID eq "+strconv.Itoa(cmd.Process.Pid), "/NH").Output()
	if err != nil {
		return false
	}
	return len(out) > 0 && out[0] != 'I'
}

func killProcess(cmd *exec.Cmd) error {
	if cmd.Process == nil {
		return nil
	}
	treeKill := exec.Command("taskkill", "/F", "/T", "/PID", strconv.Itoa(cmd.Process.Pid))
	treeKill.Stdout = nil
	treeKill.Stderr = nil
	return treeKill.Run()
}
