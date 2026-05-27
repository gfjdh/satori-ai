@echo off
echo ========================================
echo Backend Service - Environment Setup
echo ========================================
echo.

cd /d "%~dp0..\.."
if not exist "package.json" (
    echo ERROR: backend directory not found. Expected package.json at %CD%
    exit /b 1
)

echo [1/3] Checking Node.js...
where node >nul 2>&1
if errorlevel 1 (
    echo ERROR: Node.js not found. Please install Node.js first.
    echo Download: https://nodejs.org/
    exit /b 1
)
echo OK: Node.js ready

echo.
echo [2/3] Installing npm dependencies...
call npm install
if errorlevel 1 (
    echo ERROR: npm install failed
    exit /b 1
)
echo OK: Dependencies installed

echo.
echo [3/3] Building TypeScript...
call npm run build
if errorlevel 1 (
    echo ERROR: build failed
    exit /b 1
)
echo OK: Build complete

echo.
echo ========================================
echo Backend environment setup complete!
echo ========================================
echo.
echo Next: Run 02_start_service.bat to start backend service
echo.
pause