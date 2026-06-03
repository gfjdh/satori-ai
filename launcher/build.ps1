# Satori Launcher build script
# Output: Satori-Launcher.exe (embeds launcher/webui/dist/)
param(
    [switch]$NoWebUI,
    [switch]$Help
)

if ($Help) {
    Write-Host @"
Usage: .\build.ps1 [-NoWebUI] [-Help]

Builds the Satori Launcher executable with embedded WebUI.

Options:
  -NoWebUI   Skip WebUI build (use existing dist/ if present)
  -Help      Show this help message

Output:
  Satori-Launcher.exe    Go binary with embedded webui/dist/
"@
    exit 0
}

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot

Write-Host "=== Satori Launcher Build ===" -ForegroundColor Cyan

# 1. Build Launcher WebUI (Vite)
if (-not $NoWebUI) {
    Write-Host "[1/2] Building Launcher WebUI..." -ForegroundColor Yellow
    Set-Location "$root\webui"
    if (-not (Test-Path node_modules)) {
        Write-Host "  npm install..."
        npm install
    }
    npm run build
    if ($LASTEXITCODE -ne 0) { throw "Launcher WebUI build failed" }
    Write-Host "  Done" -ForegroundColor Green
}

# 2. Build Go
Write-Host "[2/2] Building Go..." -ForegroundColor Yellow
Set-Location $root
go mod tidy
go build -ldflags "-s -w -H windowsgui" -o Satori-Launcher.exe .
if ($LASTEXITCODE -ne 0) { throw "Go build failed" }

Write-Host "=== Build complete: $root\Satori-Launcher.exe ===" -ForegroundColor Green
