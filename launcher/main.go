package main

import (
	"embed"
	"fmt"
	"io/fs"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"

	"satori-launcher/api"
	"satori-launcher/svc"
)

//go:embed webui/dist/*
var webuiFS embed.FS

func main() {
	exePath, _ := os.Executable()
	rootDir := filepath.Dir(exePath)

	// If running from source (go run), use current directory
	if _, err := os.Stat(filepath.Join(rootDir, "package.json")); err != nil {
		cwd, _ := os.Getwd()
		if _, err := os.Stat(filepath.Join(cwd, "package.json")); err == nil {
			rootDir = cwd
		}
	}

	mgr := svc.NewManager(rootDir)
	server := api.NewServer(mgr)

	mux := http.NewServeMux()

	// API routes
	mux.Handle("/api/", server.Handler())

	// Serve embedded webui
	webuiDist, err := fs.Sub(webuiFS, "webui/dist")
	if err != nil {
		fmt.Printf("Warning: webui not embedded, using dev mode\n")
	} else {
		mux.Handle("/", http.FileServer(http.FS(webuiDist)))
	}

	port := "9527"
	fmt.Printf("Satori Launcher starting on http://localhost:%s\n", port)

	// Open browser
	go openBrowser(fmt.Sprintf("http://localhost:%s", port))

	if err := http.ListenAndServe(":"+port, mux); err != nil {
		fmt.Fprintf(os.Stderr, "Server error: %v\n", err)
		os.Exit(1)
	}
}

func openBrowser(url string) {
	switch runtime.GOOS {
	case "windows":
		exec.Command("rundll32", "url.dll,FileProtocolHandler", url).Start()
	case "darwin":
		exec.Command("open", url).Start()
	default:
		exec.Command("xdg-open", url).Start()
	}
}
