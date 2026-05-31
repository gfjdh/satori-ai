@echo off
echo ========================================
echo Browser Service - Starting (port 8743)
echo ========================================
echo.

set "SVC_ROOT=%~dp0..\..\services\browser"

cd /d "%SVC_ROOT%"
set "SVC_ROOT=%CD%"

if not exist "%SVC_ROOT%\venv\Scripts\python.exe" (
    echo ERROR: Virtual environment not found. Run 01_setup_env.bat first.
    exit /b 1
)

echo Starting Browser service (Playwright headless Chromium)...
echo - Health:  http://localhost:8743/health
echo - API:     http://localhost:8743/
echo.

start "Browser Service" cmd /k "venv\Scripts\python.exe server.py"

echo.
echo Browser service is starting in a new window...
echo Note: First run will initialize Playwright, please wait.
echo.
pause
