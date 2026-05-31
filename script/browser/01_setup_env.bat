@echo off
echo ========================================
echo Browser Service - Environment Setup
echo ========================================
echo.

set "SVC_ROOT=%~dp0..\..\services\browser"

cd /d "%SVC_ROOT%"
set "SVC_ROOT=%CD%"

echo [Info] Browser service root: %SVC_ROOT%
echo.

if not exist "%SVC_ROOT%" (
    echo ERROR: Browser service directory not found: %SVC_ROOT%
    exit /b 1
)

echo [1/3] Checking virtual environment...
if not exist "%SVC_ROOT%\venv\Scripts\python.exe" (
    echo Creating virtual environment...
    python -m venv "%SVC_ROOT%\venv"
)
echo OK: Virtual environment ready

echo.
echo [2/3] Installing dependencies...
call "%SVC_ROOT%\venv\Scripts\python.exe" -m pip install -r "%SVC_ROOT%\requirements.txt"
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Failed to install dependencies
    exit /b 1
)
echo OK: Dependencies installed

echo.
echo [3/3] Installing Playwright Chromium...
call "%SVC_ROOT%\venv\Scripts\python.exe" -m playwright install chromium
if %ERRORLEVEL% NEQ 0 (
    echo WARNING: Playwright Chromium install may have failed
    echo You may need to run manually: playwright install chromium
)

echo.
echo ========================================
echo Browser environment setup complete!
echo Venv location: %SVC_ROOT%\venv
echo ========================================
echo.
echo Next: Run 02_start_service.bat to start Browser service
echo.
pause
