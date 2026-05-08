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
        $env:PORT = $port
        python app.py
    } -ArgumentList $ttsPath, $ttsPort

    # Wait and verify the service actually started
    Start-Sleep 3

    try {
        $response = Invoke-WebRequest -Uri "http://127.0.0.1:$ttsPort/api/health" -UseBasicParsing -TimeoutSec 3
        if ($response.StatusCode -eq 200) {
            Write-Host " OK (running)" -ForegroundColor Green
            return
        }
    } catch {
        # Service not responding
    }

    # Check if job is still running (it might have crashed)
    $jobInfo = Get-Job -Id $job.Id -ErrorAction SilentlyContinue
    if ($jobInfo.State -eq 'Running') {
        # Job is running but service not responding - might still be loading
        Write-Host " OK (job running, checking port...)" -ForegroundColor Yellow
        return
    }

    # Job failed to start or crashed
    Write-Host ""
    Write-Host "  FAILED: TTS service not responding after 3s" -ForegroundColor Red
    Write-Host "  Job state: $($jobInfo.State)" -ForegroundColor Yellow
    Write-Host "  Hint: Check tts-service/app.py for errors, ensure venv is set up" -ForegroundColor Yellow
    Stop-Job -Id $job.Id -ErrorAction SilentlyContinue
    Remove-Job -Id $job.Id -ErrorAction SilentlyContinue
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
        python -m uvicorn main:app --host 0.0.0.0 --port $port
    } -ArgumentList $embPath, $embeddingPort

    # Wait and verify the service actually started
    Start-Sleep 3

    try {
        $response = Invoke-WebRequest -Uri "http://127.0.0.1:$embeddingPort/health" -UseBasicParsing -TimeoutSec 3
        if ($response.StatusCode -eq 200) {
            Write-Host " OK (running)" -ForegroundColor Green
            return
        }
    } catch {
        # Service not responding
    }

    $jobInfo = Get-Job -Id $job.Id -ErrorAction SilentlyContinue
    if ($jobInfo.State -eq 'Running') {
        Write-Host " OK (job running, checking port...)" -ForegroundColor Yellow
        return
    }

    Write-Host ""
    Write-Host "  FAILED: Embedding service not responding after 3s" -ForegroundColor Red
    Write-Host "  Job state: $($jobInfo.State)" -ForegroundColor Yellow
    Write-Host "  Hint: Check embedding-service/main.py for errors" -ForegroundColor Yellow
    Stop-Job -Id $job.Id -ErrorAction SilentlyContinue
    Remove-Job -Id $job.Id -ErrorAction SilentlyContinue
}

function Start-Backend-Service {
    Write-Host "[Start] Backend (port $backendPort)..." -NoNewline
    $job = Start-Job -ScriptBlock {
        param($path, $port)
        Set-Location $path
        $env:PORT = $port
        npm run dev
    } -ArgumentList $projectRoot, $backendPort

    Start-Sleep 3

    try {
        $response = Invoke-WebRequest -Uri "http://localhost:$backendPort/api/health" -UseBasicParsing -TimeoutSec 3
        if ($response.StatusCode -eq 200) {
            Write-Host " OK (running)" -ForegroundColor Green
            return
        }
    } catch {
    }

    $jobInfo = Get-Job -Id $job.Id -ErrorAction SilentlyContinue
    if ($jobInfo.State -eq 'Running') {
        Write-Host " OK (job running)" -ForegroundColor Yellow
        return
    }

    Write-Host ""
    Write-Host "  FAILED: Backend not responding after 3s" -ForegroundColor Red
    Write-Host "  Job state: $($jobInfo.State)" -ForegroundColor Yellow
    Stop-Job -Id $job.Id -ErrorAction SilentlyContinue
    Remove-Job -Id $job.Id -ErrorAction SilentlyContinue
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

    Start-Sleep 3

    try {
        $response = Invoke-WebRequest -Uri "http://localhost:$webuiPort" -UseBasicParsing -TimeoutSec 3
        if ($response.StatusCode -eq 200) {
            Write-Host " OK (running)" -ForegroundColor Green
            return
        }
    } catch {
    }

    $jobInfo = Get-Job -Id $job.Id -ErrorAction SilentlyContinue
    if ($jobInfo.State -eq 'Running') {
        Write-Host " OK (job running)" -ForegroundColor Yellow
        return
    }

    Write-Host ""
    Write-Host "  FAILED: WebUI not responding after 3s" -ForegroundColor Red
    Write-Host "  Job state: $($jobInfo.State)" -ForegroundColor Yellow
    Stop-Job -Id $job.Id -ErrorAction SilentlyContinue
    Remove-Job -Id $job.Id -ErrorAction SilentlyContinue
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

    $live2dScript = Join-Path $projectRoot "live2d-widget\live2d-launcher.py"
    $proc = Start-Process -FilePath "pythonw.exe" -ArgumentList $live2dScript -WorkingDirectory "$projectRoot\live2d-widget" -WindowStyle Hidden -PassThru

    Start-Sleep 3

    if ($proc -and -not $proc.HasExited) {
        Write-Host " OK (running, PID: $($proc.Id))" -ForegroundColor Green
    } else {
        Write-Host ""
        Write-Host "  FAILED: Live2D launcher exited immediately (exit code: $($proc.ExitCode))" -ForegroundColor Red
        Write-Host "  Hint: Run 'python live2d-widget\live2d-launcher.py' manually to see errors" -ForegroundColor Yellow
    }
}

function Stop-All-Services {
    Write-Host ""
    Write-Host "[Stop] Stopping all services..." -ForegroundColor Yellow

    # Stop all background jobs
    Get-Job | Stop-Job -ErrorAction SilentlyContinue
    Get-Job | Remove-Job -ErrorAction SilentlyContinue

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