@echo off
echo ========================================
echo WebUI Service - Environment Setup
echo ========================================
echo.

cd /d "%~dp0..\..\webui"
if not exist "package.json" (
    echo ERROR: webui directory not found. Expected package.json at %CD%
    exit /b 1
)

echo [1/2] Checking Node.js...
where node >nul 2>&1
if errorlevel 1 (
    echo ERROR: Node.js not found. Please install Node.js first.
    exit /b 1
)
echo OK: Node.js ready

echo.
echo [2/2] Installing npm dependencies...
call npm install
if errorlevel 1 (
    echo ERROR: npm install failed
    exit /b 1
)
echo OK: Dependencies installed

echo.
echo ========================================
echo WebUI environment setup complete!
echo ========================================
echo.
echo Next: Run 02_start_service.bat to start WebUI service
echo.
pause