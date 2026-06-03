package main

import (
	"context"
	"embed"
	"io/fs"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"runtime"
	"satori-launcher/api"
	"satori-launcher/svc"
	"strconv"
	"strings"
	"syscall"
	"time"
)

//go:embed webui/dist/*
var webuiDist embed.FS

func main() {
	rootDir, _ := os.Getwd()

	// Clean up orphan processes from a previous run on known ports
	svc.CleanupOrphanPorts()

	// Add this process to the global Job Object — when we exit, all children die
	svc.AssignCurrentToJob()

	// Write PID file to detect stale instances
	pidFile := filepath.Join(rootDir, ".launcher.pid")
	writePIDFile(pidFile)
	defer os.Remove(pidFile)

	srv := api.NewServer(rootDir)
	handler := srv.Routes()

	distFS, err := fs.Sub(webuiDist, "webui/dist")
	if err != nil {
		panic("embedded webui/dist not found: " + err.Error())
	}

	mux := http.NewServeMux()
	mux.Handle("/api/", handler)
	mux.Handle("/", http.FileServer(http.FS(distFS)))

	httpSrv := &http.Server{
		Addr:    ":9527",
		Handler: mux,
	}

	go func() {
		sigCh := make(chan os.Signal, 1)
		signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
		<-sigCh

		// Stop all managed services first
		srv.Manager().StopAll()

		// Brief wait for taskkill commands to complete
		time.Sleep(500 * time.Millisecond)

		// Final cleanup of known ports
		svc.CleanupOrphanPorts()

		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		httpSrv.Shutdown(ctx)
		os.Exit(0)
	}()

	go openBrowser("http://localhost:9527")

	if err := httpSrv.ListenAndServe(); err != http.ErrServerClosed {
		panic(err)
	}
}

func writePIDFile(path string) {
	// Check for stale PID file from a previous crash and clean up the old instance
	if prev, err := os.ReadFile(path); err == nil {
		if pid, err := strconv.Atoi(strings.TrimSpace(string(prev))); err == nil && pid > 0 {
			// Use tasklist to check if PID is still alive on Windows
			checkCmd := exec.Command("tasklist", "/FI", "PID eq "+strconv.Itoa(pid), "/NH")
			checkCmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
			if out, err := checkCmd.Output(); err == nil && len(out) > 0 && out[0] != 'I' {
				// Old process still running — kill it before taking over
				killCmd := exec.Command("taskkill", "/F", "/T", "/PID", strconv.Itoa(pid))
				killCmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
				killCmd.Run()
			}
		}
	}
	os.WriteFile(path, []byte(strconv.Itoa(os.Getpid())), 0644)
}

func openBrowser(url string) {
	switch runtime.GOOS {
	case "windows":
		svc.NewHiddenCommand("cmd", "/c", "start", url).Start()
	case "darwin":
		svc.NewHiddenCommand("open", url).Start()
	default:
		svc.NewHiddenCommand("xdg-open", url).Start()
	}
}

func init() {
	exe, _ := os.Executable()
	dir := filepath.Dir(exe)
	if dir != "." {
		os.Chdir(dir)
	}
}
