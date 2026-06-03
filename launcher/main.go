package main

import (
	"context"
	"embed"
	"io/fs"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"runtime"
	"satori-launcher/api"
	"satori-launcher/svc"
	"syscall"
	"time"
)

//go:embed webui/dist/*
var webuiDist embed.FS

func main() {
	rootDir, _ := os.Getwd()

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
		srv.Manager().StopAll()
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
