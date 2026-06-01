# Satori AI - Service Manager
# Usage:
#   .\start.ps1 -service <name>    start a service
#   .\start.ps1 -stop <name>       stop a service
#   .\start.ps1                    interactive menu

param(
    [string]$service = "menu",
    [string]$stop = ""
)

$ErrorActionPreference = "Continue"
$projectRoot = Split-Path -Parent $PSScriptRoot
$backendPort = 3682
$webuiPort = 5173
$ttsPort = 5030
$embeddingPort = 7860
$imagePort = 8742
$browserPort = 8743
$asrPort = 5032

function Wait-ServiceReady {
    param(
        [string]$JobName,
        [int]$Port,
        [string]$DisplayName,
        [int]$TimeoutSeconds = 30
    )

    $elapsed = 0
    $interval = 1
    $prevCount = 0
    $sw = [System.Diagnostics.Stopwatch]::StartNew()

    while ($elapsed -lt $TimeoutSeconds) {
        # Show new job output as it appears
        $output = @(Receive-Job -Name $JobName -Keep -ErrorAction SilentlyContinue 2>&1)
        if ($output.Count -gt $prevCount) {
            for ($i = $prevCount; $i -lt $output.Count; $i++) {
                $line = ($output[$i] | Out-String).Trim()
                if ($line) {
                    Write-Host "`n  $line" -ForegroundColor DarkGray -NoNewline
                }
            }
            $prevCount = $output.Count
        }

        # Check if job died
        $job = Get-Job -Name $JobName -ErrorAction SilentlyContinue
        if ($job -and $job.State -eq 'Failed') {
            Write-Host "`n"
            Write-Host "[Error] $DisplayName job failed" -ForegroundColor Red
            $err = Receive-Job -Name $JobName -Keep 2>&1
            if ($err) { Write-Host ($err | Out-String) -ForegroundColor Red }
            return $false
        }

        # Check job output for ready signal (more reliable than TCP probing)
        $output = @(Receive-Job -Name $JobName -Keep -ErrorAction SilentlyContinue 2>&1)
        $text = ($output | Out-String).ToLower()
        $ready = $text -match "(ready in|local:|running on|uvicorn running|server running|listening|started server)"


        # Port check - try IPv4 then IPv6 loopback
        if (-not $ready) {
            $connected = $false
            foreach ($addr in @("127.0.0.1", "::1")) {
                try {
                    $tcp = New-Object System.Net.Sockets.TcpClient
                    $task = $tcp.ConnectAsync($addr, $Port)
                    if ($task.Wait(800) -and -not $task.IsFaulted) {
                        $tcp.Close()
                        $connected = $true
                        break
                    }
                    $tcp.Close()
                } catch { }
            }
            $ready = $connected
        }
        if ($ready) {
            Write-Host "`n"
            Write-Host "[$DisplayName] ready (port $Port, ${elapsed}s)" -ForegroundColor Green
            return $true
        }

        Write-Host "." -NoNewline
        Start-Sleep $interval
        $elapsed = [int]$sw.Elapsed.TotalSeconds
    }

    Write-Host "`n"
    Write-Host "[Timeout] $DisplayName did not respond on port $Port after ${TimeoutSeconds}s" -ForegroundColor Yellow
    return $false
}

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
    Write-Host "  [6] Image        (port $imagePort)" -ForegroundColor White
    Write-Host "  [7] Browser      (port $browserPort)" -ForegroundColor White
    Write-Host "  [8] ASR          (port $asrPort)" -ForegroundColor White
    Write-Host "  [A] All (backend + webui + services)" -ForegroundColor Yellow
    Write-Host "  [S] Services Only (WebUI/TTS/Embed/Image/Browser/ASR)" -ForegroundColor Yellow
    Write-Host "  [K] Stop All Services" -ForegroundColor Red
    Write-Host "  [X] Stop Specific Service" -ForegroundColor Red
    Write-Host "  [Q] Quit" -ForegroundColor Red
    Write-Host ""
}

function Start-Backend-Service {
    Write-Host "[Start] Backend (port $backendPort)..." -NoNewline
    $job = Start-Job -Name "Satori-Backend" -ScriptBlock {
        param($path, $port)
        Set-Location $path
        $env:PORT = $port
        npm run dev
    } -ArgumentList $projectRoot, $backendPort

    $null = Wait-ServiceReady -JobName "Satori-Backend" -Port $backendPort -DisplayName "Backend"
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

    $job = Start-Job -Name "Satori-WebUI" -ScriptBlock {
        param($path, $port)
        Set-Location $path
        npm run dev
    } -ArgumentList "$projectRoot\webui", $webuiPort

    $null = Wait-ServiceReady -JobName "Satori-WebUI" -Port $webuiPort -DisplayName "WebUI"
}

function Start-TTS-Service {
    Write-Host "[Start] TTS Service (port $ttsPort)..." -NoNewline

    $ttsPath = Join-Path $projectRoot "services\tts"
    if (-not (Test-Path "$ttsPath\venv\Scripts\python.exe")) {
        Write-Host ""
        Write-Host "  TTS venv not found. Run tts\01_setup_env.bat first." -ForegroundColor Red
        return
    }

    $job = Start-Job -Name "Satori-TTS" -ScriptBlock {
        param($path, $port)
        Set-Location $path
        & ".\venv\Scripts\python.exe" "app.py"
    } -ArgumentList $ttsPath, $ttsPort

    $null = Wait-ServiceReady -JobName "Satori-TTS" -Port $ttsPort -DisplayName "TTS" -TimeoutSeconds 120
}

function Start-Embedding-Service {
    Write-Host "[Start] Embedding Service (port $embeddingPort)..." -NoNewline

    $embPath = Join-Path $projectRoot "services\embedding"
    if (-not (Test-Path "$embPath\venv\Scripts\python.exe")) {
        Write-Host ""
        Write-Host "  Embedding venv not found. Run embedding\01_setup_env.bat first." -ForegroundColor Red
        return
    }

    $job = Start-Job -Name "Satori-Embedding" -ScriptBlock {
        param($path, $port)
        Set-Location $path
        & ".\venv\Scripts\python.exe" -m uvicorn main:app --host 0.0.0.0 --port $port
    } -ArgumentList $embPath, $embeddingPort

    $null = Wait-ServiceReady -JobName "Satori-Embedding" -Port $embeddingPort -DisplayName "Embedding"
}

function Start-Image-Service {
    Write-Host "[Start] Image Service (port $imagePort)..." -NoNewline

    $imgPath = Join-Path $projectRoot "services\image"
    if (-not (Test-Path "$imgPath\venv\Scripts\python.exe")) {
        Write-Host ""
        Write-Host "  Image venv not found. Run image\01_setup_env.bat first." -ForegroundColor Red
        return
    }

    $job = Start-Job -Name "Satori-Image" -ScriptBlock {
        param($path, $port)
        Set-Location $path
        & ".\venv\Scripts\python.exe" -m uvicorn app:app --host 0.0.0.0 --port $port
    } -ArgumentList $imgPath, $imagePort

    $null = Wait-ServiceReady -JobName "Satori-Image" -Port $imagePort -DisplayName "Image"
}

function Start-Browser-Service {
    Write-Host "[Start] Browser Service (port $browserPort)..." -NoNewline

    $browserPath = Join-Path $projectRoot "services\browser"
    if (-not (Test-Path "$browserPath\venv\Scripts\python.exe")) {
        Write-Host ""
        Write-Host "  Browser venv not found. Run browser\01_setup_env.bat first." -ForegroundColor Red
        return
    }

    $job = Start-Job -Name "Satori-Browser" -ScriptBlock {
        param($path)
        Set-Location $path
        & ".\venv\Scripts\python.exe" "server.py"
    } -ArgumentList $browserPath

    $null = Wait-ServiceReady -JobName "Satori-Browser" -Port $browserPort -DisplayName "Browser"
}

function Start-ASR-Service {
    Write-Host "[Start] ASR Service (port $asrPort)..." -NoNewline

    $asrPath = Join-Path $projectRoot "services\asr"
    if (-not (Test-Path "$asrPath\venv\Scripts\python.exe")) {
        Write-Host ""
        Write-Host "  ASR venv not found. Run asr\01_setup_env.bat first." -ForegroundColor Red
        return
    }

    $job = Start-Job -Name "Satori-ASR" -ScriptBlock {
        param($path, $port)
        Set-Location $path
        & ".\venv\Scripts\python.exe" "app.py"
    } -ArgumentList $asrPath, $asrPort

    $null = Wait-ServiceReady -JobName "Satori-ASR" -Port $asrPort -DisplayName "ASR" -TimeoutSeconds 300
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
    $proc = Start-Process -FilePath "pythonw.exe" -ArgumentList $live2dScript -WorkingDirectory "$projectRoot\live2d-widget" -WindowStyle Hidden -PassThru

    # Verify process actually started
    $elapsed = 0
    while ($elapsed -lt 10) {
        $alive = Get-Process -Id $proc.Id -ErrorAction SilentlyContinue
        if (-not $alive -or $alive.HasExited) {
            Write-Host " FAILED (process exited)" -ForegroundColor Red
            return
        }
        Write-Host "." -NoNewline
        Start-Sleep 1
        $elapsed++
    }
    Write-Host " OK (PID: $($proc.Id), running ${elapsed}s)" -ForegroundColor Green
}

function Stop-Backend-Service {
    $job = Get-Job -Name "Satori-Backend" -ErrorAction SilentlyContinue
    if ($job) {
        Stop-Job -Name "Satori-Backend"
        Remove-Job -Name "Satori-Backend" -Force
        Write-Host "  Stopped: Backend" -ForegroundColor Green
    } else {
        Write-Host "  Backend is not running" -ForegroundColor Gray
    }
}

function Stop-WebUI-Service {
    $job = Get-Job -Name "Satori-WebUI" -ErrorAction SilentlyContinue
    if ($job) {
        Stop-Job -Name "Satori-WebUI"
        Remove-Job -Name "Satori-WebUI" -Force
        Write-Host "  Stopped: WebUI" -ForegroundColor Green
    } else {
        Write-Host "  WebUI is not running" -ForegroundColor Gray
    }
}

function Stop-TTS-Service {
    $job = Get-Job -Name "Satori-TTS" -ErrorAction SilentlyContinue
    if ($job) {
        Stop-Job -Name "Satori-TTS"
        Remove-Job -Name "Satori-TTS" -Force
        Write-Host "  Stopped: TTS" -ForegroundColor Green
    } else {
        Write-Host "  TTS is not running" -ForegroundColor Gray
    }
}

function Stop-Embedding-Service {
    $job = Get-Job -Name "Satori-Embedding" -ErrorAction SilentlyContinue
    if ($job) {
        Stop-Job -Name "Satori-Embedding"
        Remove-Job -Name "Satori-Embedding" -Force
        Write-Host "  Stopped: Embedding" -ForegroundColor Green
    } else {
        Write-Host "  Embedding is not running" -ForegroundColor Gray
    }
}

function Stop-Image-Service {
    $job = Get-Job -Name "Satori-Image" -ErrorAction SilentlyContinue
    if ($job) {
        Stop-Job -Name "Satori-Image"
        Remove-Job -Name "Satori-Image" -Force
        Write-Host "  Stopped: Image" -ForegroundColor Green
    } else {
        Write-Host "  Image is not running" -ForegroundColor Gray
    }
}

function Stop-Browser-Service {
    $pidFile = Join-Path $projectRoot "services\browser\.pid"
    if (Test-Path $pidFile) {
        $browserPid = Get-Content $pidFile -Raw
        if ($browserPid) {
            $null = taskkill /F /T /PID $browserPid.Trim() 2>&1
        }
    }

    $job = Get-Job -Name "Satori-Browser" -ErrorAction SilentlyContinue
    if ($job) {
        Remove-Job -Name "Satori-Browser" -Force -ErrorAction SilentlyContinue
    }

    if ((Test-Path $pidFile) -or $job) {
        Write-Host "  Stopped: Browser" -ForegroundColor Green
    } else {
        Write-Host "  Browser is not running" -ForegroundColor Gray
    }
}

function Stop-ASR-Service {
    $job = Get-Job -Name "Satori-ASR" -ErrorAction SilentlyContinue
    if ($job) {
        Stop-Job -Name "Satori-ASR"
        Remove-Job -Name "Satori-ASR" -Force
        Write-Host "  Stopped: ASR" -ForegroundColor Green
    } else {
        Write-Host "  ASR is not running" -ForegroundColor Gray
    }
}

function Stop-Live2D-Service {
    $procs = Get-CimInstance Win32_Process -Filter "Name='pythonw.exe' OR Name='python.exe'" -ErrorAction SilentlyContinue | Where-Object {
        $_.CommandLine -like "*live2d-launcher.py*"
    }
    if ($procs) {
        $procs | ForEach-Object {
            Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
            Write-Host "  Stopped: Live2D (PID: $($_.ProcessId))" -ForegroundColor Green
        }
    } else {
        Write-Host "  Live2D is not running" -ForegroundColor Gray
    }
}

function Stop-All-Services {
    Write-Host ""
    Write-Host "[Stop] Stopping all services..." -ForegroundColor Yellow

    Stop-Backend-Service
    Stop-WebUI-Service
    Stop-TTS-Service
    Stop-Embedding-Service
    Stop-Image-Service
    Stop-Browser-Service
    Stop-ASR-Service
    Stop-Live2D-Service

    Write-Host ""
    Write-Host "Done." -ForegroundColor Cyan
}

function Start-Services-Only {
    Write-Host ""
    Write-Host "[Info] Starting WebUI + all microservices (no backend)..." -ForegroundColor Cyan
    Write-Host ""

    Start-WebUI-Service
    Start-TTS-Service
    Start-Embedding-Service
    Start-Image-Service
    Start-Browser-Service
    Start-ASR-Service

    Write-Host ""
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host "  All services started!" -ForegroundColor Green
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "  WebUI:      http://localhost:$webuiPort" -ForegroundColor White
    Write-Host "  TTS API:    http://localhost:$ttsPort/api" -ForegroundColor White
    Write-Host "  Embedding:  http://localhost:$embeddingPort" -ForegroundColor White
    Write-Host "  Image:      http://localhost:$imagePort" -ForegroundColor White
    Write-Host "  Browser:    http://localhost:$browserPort" -ForegroundColor White
    Write-Host "  ASR:        http://localhost:$asrPort/api" -ForegroundColor White
    Write-Host ""
}

function Start-All-Services {
    Write-Host ""
    Write-Host "[Info] Starting all services..." -ForegroundColor Cyan
    Write-Host ""

    Start-Backend-Service
    Start-WebUI-Service
    Start-TTS-Service
    Start-Embedding-Service
    Start-Image-Service
    Start-Browser-Service
    Start-ASR-Service
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
    Write-Host "  Image:      http://localhost:$imagePort" -ForegroundColor White
    Write-Host "  Browser:    http://localhost:$browserPort" -ForegroundColor White
    Write-Host "  ASR:        http://localhost:$asrPort/api" -ForegroundColor White
    Write-Host ""
}

# Main logic

# Handle -stop first (targeted stop + exit)
if ($stop) {
    Write-Host ""
    Write-Host "[Stop] Stopping: $stop" -ForegroundColor Yellow
    switch ($stop.ToLower()) {
        "backend"   { Stop-Backend-Service }
        "webui"     { Stop-WebUI-Service }
        "tts"       { Stop-TTS-Service }
        "embedding" { Stop-Embedding-Service }
        "live2d"    { Stop-Live2D-Service }
        "image"     { Stop-Image-Service }
        "browser"   { Stop-Browser-Service }
        "asr"       { Stop-ASR-Service }
        "all"       { Stop-All-Services }
        default {
            Write-Host "Unknown service: $stop" -ForegroundColor Red
            Write-Host "Valid: backend, webui, tts, embedding, live2d, image, browser, asr, all" -ForegroundColor Gray
        }
    }
    exit
}

switch ($service.ToLower()) {
    "backend" { Start-Backend-Service }
    "webui" { Start-WebUI-Service }
    "tts" { Start-TTS-Service }
    "embedding" { Start-Embedding-Service }
    "live2d" { Start-Live2D-Service }
    "image" { Start-Image-Service }
    "browser" { Start-Browser-Service }
    "asr" { Start-ASR-Service }
    "services" { Start-Services-Only }
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
                "6" { Start-Image-Service }
                "image" { Start-Image-Service }
                "7" { Start-Browser-Service }
                "browser" { Start-Browser-Service }
                "8" { Start-ASR-Service }
                "asr" { Start-ASR-Service }
                "a" { Start-All-Services }
                "all" { Start-All-Services }
                "s" { Start-Services-Only }
                "services" { Start-Services-Only }
                "k" { Stop-All-Services }
                "stop" { Stop-All-Services }
                "x" {
                    Write-Host ""
                    Write-Host "  Stop which service?" -ForegroundColor Yellow
                    Write-Host "  [1] Backend   [2] WebUI   [3] TTS   [4] Embedding" -ForegroundColor White
                    Write-Host "  [5] Live2D    [6] Image   [7] Browser   [8] ASR" -ForegroundColor White
                    $stopChoice = Read-Host "  Choice (or Enter to cancel)"
                    switch ($stopChoice) {
                        "1" { Stop-Backend-Service }
                        "2" { Stop-WebUI-Service }
                        "3" { Stop-TTS-Service }
                        "4" { Stop-Embedding-Service }
                        "5" { Stop-Live2D-Service }
                        "6" { Stop-Image-Service }
                        "7" { Stop-Browser-Service }
                        "8" { Stop-ASR-Service }
                        "" { }
                        default { Write-Host "  Invalid: $stopChoice" -ForegroundColor Red }
                    }
                }
                "q" { break }
                default {
                    Write-Host "Invalid choice: $choice" -ForegroundColor Red
                }
            }
            if ($choice -eq "q") { break }
        }
    }
    default {
        Write-Host "Usage: .\start.ps1 [-service <name>] [-stop <name>]" -ForegroundColor Yellow
        Write-Host "  -service: backend | webui | tts | embedding | live2d | image | browser | asr | services | all | menu" -ForegroundColor Gray
        Write-Host "  -stop:    backend | webui | tts | embedding | live2d | image | browser | asr | all" -ForegroundColor Gray
        Write-Host "  No args - showing menu" -ForegroundColor Gray
        & $PSCommandPath -service menu
    }
}