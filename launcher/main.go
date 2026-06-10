package main

import (
	"embed"
	"io"
	"io/fs"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"satori-launcher/api"
	"satori-launcher/svc"

	"golang.org/x/sys/windows"
)

//go:embed webui/dist/*
var webuiEmbed embed.FS

func init() {
	exePath, err := os.Executable()
	if err == nil {
		os.Chdir(filepath.Dir(exePath))
	}
}

func main() {
	rootDir, _ := os.Getwd()

	// single-instance detection via port check.
	// Windows Mutex GetLastError() is unreliable because Go's syscall
	// package clears the thread last error after each syscall.
	if svc.IsPortInUse(9527) {
		showMessage("Satori AI Launcher", "Satori AI is already running.\n\nOpen http://localhost:3682 in your browser,\nor close the existing launcher first.\n\nIf the launcher is not responding, terminate\nSatori-Launcher.exe in Task Manager and try again.")
		os.Exit(1)
	}

	// cleanup orphan ports from crashed instances
	svc.CleanupOrphanPorts()

	// secondary mutex guard (best-effort)
	mutexName := "Satori-Launcher-Singleton"
	mutex, err := windows.CreateMutex(nil, false, windows.StringToUTF16Ptr(mutexName))
	if err != nil {
		svc.LogError("CreateMutex failed: %v", err)
	}
	if mutex != 0 {
		defer windows.CloseHandle(mutex)
	}

	// join job object
	if err := svc.AssignCurrentToJob(); err != nil {
		svc.LogError("assign self to job object: %v", err)
	}

	// service manager
	mgr := svc.NewManager(rootDir)

	// Background state refresh — detect process exits without waiting for frontend polling
	go func() {
		for {
			time.Sleep(2 * time.Second)
			mgr.RefreshAll()
		}
	}()

	// HTTP server
	srv := api.NewServer(mgr, rootDir)

	// wrap with SPA fallback + CORS
	handler := spaMiddleware(webuiEmbed, srv.Handler())

	httpServer := &http.Server{
		Addr:    ":9527",
		Handler: handler,
	}

	// graceful shutdown
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		<-sigCh
		svc.LogInfo("", "signal received, shutting down")
		mgr.StopAll()
		svc.CleanupOrphanPorts()
		os.Exit(0)
	}()

	// open browser
	svc.LogInfo("", "Launcher starting on http://localhost:9527")
	go openBrowser("http://localhost:9527")

	if err := httpServer.ListenAndServe(); err != http.ErrServerClosed {
		svc.LogError("HTTP server error: %v", err)
		os.Exit(1)
	}
}

func showMessage(title, msg string) {
	titleU16, _ := windows.UTF16PtrFromString(title)
	msgU16, _ := windows.UTF16PtrFromString(msg)
	windows.MessageBox(0, msgU16, titleU16, windows.MB_OK|windows.MB_ICONINFORMATION)
}

func openBrowser(url string) {
	exec.Command("rundll32", "url.dll,FileProtocolHandler", url).Start()
}

func spaMiddleware(embedFS embed.FS, apiHandler http.Handler) http.Handler {
	webuiFS, err := fs.Sub(embedFS, "webui/dist")
	if err != nil {
		// webui/dist not embedded — serve API only, no SPA fallback
		return apiHandler
	}

	fileServer := http.FileServer(http.FS(webuiFS))

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// CORS
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		if r.Method == http.MethodOptions {
			w.WriteHeader(200)
			return
		}

		// API routes
		if strings.HasPrefix(r.URL.Path, "/api/") {
			apiHandler.ServeHTTP(w, r)
			return
		}

		// try static file
		path := strings.TrimPrefix(r.URL.Path, "/")
		f, err := webuiFS.Open(path)
		if err != nil {
			// SPA fallback: serve index.html
			index, indexErr := webuiFS.Open("index.html")
			if indexErr != nil {
				http.NotFound(w, r)
				return
			}
			defer index.Close()
			stat, _ := index.Stat()
			http.ServeContent(w, r, "index.html", stat.ModTime(), index.(io.ReadSeeker))
			return
		}
		f.Close()
		fileServer.ServeHTTP(w, r)
	})
}
