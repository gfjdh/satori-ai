# Satori AI Startup Script
# Usage: .\start.ps1 -character <id> [-mode <all|api|webui>]
#   -character  CURRENT_CHARACTER_ID (required)
#   -mode       Start mode: -all (default), -api, -webui

param(
    [string]$mode = "all",
    [string]$character
)

$ErrorActionPreference = "Continue"
$projectRoot = $PSScriptRoot
$backendPort = 3000
$webuiPort = 5173

# 加载 .env（如果存在）
$envFile = Join-Path $projectRoot ".env"
if (Test-Path $envFile) {
    Get-Content $envFile | ForEach-Object {
        if ($_ -match '^([^=]+)=(.*)$') {
            $name = $matches[1].Trim()
            $value = $matches[2].Trim()
            $envPath = "env:$name"
            if (-not (Test-Path $envPath)) {
                Set-Item -Path $envPath -Value $value
            }
        }
    }
}

if ($character) {
    $env:CURRENT_CHARACTER_ID = $character
}

if (-not $env:CURRENT_CHARACTER_ID) {
    throw "CURRENT_CHARACTER_ID environment variable is not set"
}

Write-Host "[Info] Character: $env:CURRENT_CHARACTER_ID" -ForegroundColor Gray

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Satori AI - Startup Script" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Check Node.js
Write-Host "[Check] Node.js..." -NoNewline
try {
    $nodeVersion = node --version
    Write-Host " OK ($nodeVersion)" -ForegroundColor Green
} catch {
    Write-Host " Not found" -ForegroundColor Red
    Write-Host "Please install Node.js: https://nodejs.org/" -ForegroundColor Yellow
    exit 1
}

# Start Backend
function Start-Backend {
    Write-Host "[Start] Backend (port $backendPort)..." -NoNewline
    $env:PORT = $backendPort
    $env:CURRENT_CHARACTER_ID = $env:CURRENT_CHARACTER_ID  # 透传环境变量

    $backendJob = Start-Job -ScriptBlock {
        param($path, $port, $charId)
        Set-Location $path
        $env:PORT = $port
        $env:CURRENT_CHARACTER_ID = $charId
        npm run dev
    } -ArgumentList $projectRoot, $backendPort, $env:CURRENT_CHARACTER_ID

    # Wait for backend
    for ($i = 0; $i -lt 15; $i++) {
        Start-Sleep 1
        try {
            $response = Invoke-RestMethod "http://localhost:$backendPort/api/health" -TimeoutSec 2
            if ($response.status -eq "ok") {
                Write-Host " OK" -ForegroundColor Green
                Write-Host "  Backend: http://localhost:$backendPort" -ForegroundColor Gray
                return $true
            }
        } catch {}
    }

    Write-Host " Starting..." -ForegroundColor Yellow
    return $true
}

# Start WebUI
function Start-WebUI {
    Write-Host "[Start] WebUI (port $webuiPort)..." -NoNewline

    # Check dependencies
    if (-not (Test-Path "$projectRoot\webui\node_modules")) {
        Write-Host ""
        Write-Host "  First run, installing dependencies..." -ForegroundColor Yellow
        Push-Location "$projectRoot\webui"
        npm install
        Pop-Location
        Write-Host "  Dependencies installed" -ForegroundColor Green
    }

    $webuiJob = Start-Job -ScriptBlock {
        param($path, $port)
        Set-Location $path
        npm run dev
    } -ArgumentList "$projectRoot\webui", $webuiPort

    # Wait for WebUI
    for ($i = 0; $i -lt 15; $i++) {
        Start-Sleep 1
        try {
            $response = Invoke-WebRequest "http://localhost:$webuiPort" -TimeoutSec 2 -UseBasicParsing
            if ($response.StatusCode -eq 200) {
                Write-Host " OK" -ForegroundColor Green
                Write-Host "  WebUI: http://localhost:$webuiPort" -ForegroundColor Gray
                return $true
            }
        } catch {}
    }

    Write-Host " Starting..." -ForegroundColor Yellow
    return $true
}

# Main logic
switch ($mode.ToLower()) {
    "all" {
        $backendStarted = Start-Backend
        $webuiStarted = Start-WebUI
    }
    "api" {
        Start-Backend
    }
    "webui" {
        Start-WebUI
    }
    default {
        Write-Host "Unknown mode: $mode" -ForegroundColor Red
        Write-Host "Usage: .\start.ps1 [-all|-api|-webui]" -ForegroundColor Yellow
        exit 1
    }
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Startup Complete!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Backend API: http://localhost:$backendPort" -ForegroundColor White
if ($mode -ne "api") {
    Write-Host "  WebUI:       http://localhost:$webuiPort" -ForegroundColor White
}
Write-Host ""
Write-Host "Press Ctrl+C to stop" -ForegroundColor Gray
Write-Host ""

# Wait for interrupt
$jobs = Get-Job
try {
    while ($true) {
        Start-Sleep 1
    }
} finally {
    Write-Host ""
    Write-Host "[Stop] Shutting down services..." -ForegroundColor Yellow
    Stop-Job -Job $jobs -ErrorAction SilentlyContinue
    Remove-Job -Job $jobs -Force -ErrorAction SilentlyContinue
    Write-Host "Done" -ForegroundColor Green
}
