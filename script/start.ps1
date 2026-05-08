# Satori AI - Service Manager
# Usage: .\start.ps1 -service <backend|webui|tts|embedding|live2d|all>

param(
    [string]$service = "menu"
)

$ErrorActionPreference = "Continue"
$projectRoot = Split-Path -Parent $PSScriptRoot
$backendPort = 3000
$webuiPort = 5173
$ttsPort = 5030
$embeddingPort = 7860

function Show-Menu {
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host "  Satori AI - Service Manager" -ForegroundColor Cyan
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "  [1] Backend      (port $backendPort)" -ForegroundColor White
    Write-Host "  [2] WebUI        (port $webuiPort)" -ForegroundColor White
    Write-Host "  [3] TTS          (port $ttsPort)" -ForegroundColor White
    Write-Host "  [4] Embedding    (port $embeddingPort)" -ForegroundColor White
    Write-Host "  [5] Live2D      (system Python)" -ForegroundColor White
    Write-Host "  [A] All Services" -ForegroundColor Yellow
    Write-Host "  [K] Stop All Services" -ForegroundColor Red
    Write-Host "  [Q] Quit" -ForegroundColor Red
    Write-Host ""
}

function Start-Backend-Service {
    Write-Host "[Start] Backend (port $backendPort)..." -NoNewline
    $job = Start-Job -ScriptBlock {
        param($path, $port)
        Set-Location $path
        $env:PORT = $port
        npm run dev
    } -ArgumentList $projectRoot, $backendPort

    Start-Sleep 2
    Write-Host " OK (running in background job)" -ForegroundColor Green
}

function Start-WebUI-Service {
    Write-Host "[Start] WebUI (port $webuiPort)..." -NoNewline

    if (-not (Test-Path "$projectRoot\webui\node_modules")) {
        Write-Host ""
        Write-Host "  First run, installing dependencies..." -ForegroundColor Yellow
        Push-Location "$projectRoot\webui"
        npm install
        Pop-Location
    }

    $job = Start-Job -ScriptBlock {
        param($path, $port)
        Set-Location $path
        npm run dev
    } -ArgumentList "$projectRoot\webui", $webuiPort

    Start-Sleep 2
    Write-Host " OK (running in background job)" -ForegroundColor Green
}

function Start-TTS-Service {
    Write-Host "[Start] TTS Service (port $ttsPort)..." -NoNewline

    $ttsPath = Join-Path $projectRoot "tts-service"
    if (-not (Test-Path "$ttsPath\venv\Scripts\python.exe")) {
        Write-Host ""
        Write-Host "  TTS venv not found. Run tts\01_setup_env.bat first." -ForegroundColor Red
        return
    }

    $job = Start-Job -ScriptBlock {
        param($path, $port)
        Set-Location $path
        & ".\venv\Scripts\python.exe" "app.py"
    } -ArgumentList $ttsPath, $ttsPort

    Start-Sleep 2
    Write-Host " OK (running in background job)" -ForegroundColor Green
}

function Start-Embedding-Service {
    Write-Host "[Start] Embedding Service (port $embeddingPort)..." -NoNewline

    $embPath = Join-Path $projectRoot "embedding-service"
    if (-not (Test-Path "$embPath\venv\Scripts\python.exe")) {
        Write-Host ""
        Write-Host "  Embedding venv not found. Run embedding\01_setup_env.bat first." -ForegroundColor Red
        return
    }

    $job = Start-Job -ScriptBlock {
        param($path, $port)
        Set-Location $path
        & ".\venv\Scripts\python.exe" -m uvicorn main:app --host 0.0.0.0 --port $port
    } -ArgumentList $embPath, $embeddingPort

    Start-Sleep 2
    Write-Host " OK (running in background job)" -ForegroundColor Green
}

function Start-Live2D-Service {
    Write-Host "[Start] Live2D Launcher (system Python)..." -NoNewline

    try {
        $null = python -c "from PySide6.QtWidgets import QApplication" 2>$null
        if ($LASTEXITCODE -ne 0) {
            Write-Host ""
            Write-Host "  PySide6 not found in system Python. Run live2d\01_setup_env.bat to check." -ForegroundColor Red
            return
        }
    } catch {
        Write-Host ""
        Write-Host "  Python not found. Please install Python + PySide6." -ForegroundColor Red
        return
    }

    # Use pythonw.exe to avoid console window popup
    $live2dScript = Join-Path $projectRoot "live2d-widget\live2d-launcher.py"
    Start-Process -FilePath "pythonw.exe" -ArgumentList $live2dScript -WorkingDirectory "$projectRoot\live2d-widget" -WindowStyle Hidden
    Start-Sleep 2
    Write-Host " OK" -ForegroundColor Green
}

function Stop-All-Services {
    Write-Host ""
    Write-Host "[Stop] Stopping all services..." -ForegroundColor Yellow

    # Kill by window title (non-blocking)
    $windowTitles = @("Backend", "WebUI", "TTS Service", "Embedding Service", "Live2D Launcher")
    foreach ($title in $windowTitles) {
        Get-Process | Where-Object { $_.MainWindowTitle -like "*$title*" } | ForEach-Object {
            Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
            Write-Host "  Stopped: $title (PID: $($_.Id))" -ForegroundColor Green
        }
    }

    # Kill node processes (Backend + WebUI)
    Get-Process node -ErrorAction SilentlyContinue | ForEach-Object {
        Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
        Write-Host "  Stopped: node (PID: $($_.Id))" -ForegroundColor Green
    }

    # Kill python processes for TTS/Embedding/Live2D
    Get-Process python -ErrorAction SilentlyContinue | ForEach-Object {
        Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
        Write-Host "  Stopped: python (PID: $($_.Id))" -ForegroundColor Green
    }

    Write-Host ""
    Write-Host "Done. Some processes may have already exited." -ForegroundColor Cyan
}

function Start-All-Services {
    Write-Host ""
    Write-Host "[Info] Starting all services..." -ForegroundColor Cyan
    Write-Host ""

    Start-Backend-Service
    Start-WebUI-Service
    Start-TTS-Service
    Start-Embedding-Service
    Start-Live2D-Service

    Write-Host ""
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host "  All services started!" -ForegroundColor Green
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "  Backend:    http://localhost:$backendPort" -ForegroundColor White
    Write-Host "  WebUI:      http://localhost:$webuiPort" -ForegroundColor White
    Write-Host "  TTS API:    http://localhost:$ttsPort/api" -ForegroundColor White
    Write-Host "  Embedding:  http://localhost:$embeddingPort" -ForegroundColor White
    Write-Host ""
}

# Main logic
switch ($service.ToLower()) {
    "backend" { Start-Backend-Service }
    "webui" { Start-WebUI-Service }
    "tts" { Start-TTS-Service }
    "embedding" { Start-Embedding-Service }
    "live2d" { Start-Live2D-Service }
    "all" { Start-All-Services }
    "menu" {
        while ($true) {
            Show-Menu
            $choice = Read-Host "Select service to start"
            switch ($choice.ToLower()) {
                "1" { Start-Backend-Service }
                "backend" { Start-Backend-Service }
                "2" { Start-WebUI-Service }
                "webui" { Start-WebUI-Service }
                "3" { Start-TTS-Service }
                "tts" { Start-TTS-Service }
                "4" { Start-Embedding-Service }
                "embedding" { Start-Embedding-Service }
                "5" { Start-Live2D-Service }
                "live2d" { Start-Live2D-Service }
                "a" { Start-All-Services }
                "all" { Start-All-Services }
                "k" { Stop-All-Services }
                "stop" { Stop-All-Services }
                "q" { break }
                default {
                    Write-Host "Invalid choice: $choice" -ForegroundColor Red
                }
            }
            if ($choice -eq "q") { break }
        }
    }
    default {
        Write-Host "Usage: .\start.ps1 [-service <backend|webui|tts|embedding|live2d|all|menu>]" -ForegroundColor Yellow
        Write-Host "  No service specified - showing menu" -ForegroundColor Gray
        & $PSCommandPath -service menu
    }
}