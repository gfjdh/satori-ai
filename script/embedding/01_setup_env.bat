@echo off
echo ========================================
echo Embedding Service - Environment Setup
echo ========================================
echo.

set "EMB_ROOT=%~dp0..\..\services\embedding"

cd /d "%EMB_ROOT%"
set "EMB_ROOT=%CD%"

echo [Info] Embedding service root: %EMB_ROOT%
echo.

if not exist "%EMB_ROOT%" (
    echo ERROR: Embedding service directory not found: %EMB_ROOT%
    exit /b 1
)

echo [1/2] Checking virtual environment...
if not exist "%EMB_ROOT%\venv\Scripts\python.exe" (
    echo Creating virtual environment...
    python -m venv "%EMB_ROOT%\venv"
)
echo OK: Virtual environment ready

echo.
echo [2/2] Installing dependencies...
echo [Info] This may take 5-15 minutes on first run (torch is ~2.5GB)...
"%EMB_ROOT%\venv\Scripts\python.exe" -m pip install -r "%EMB_ROOT%\requirements.txt" --progress-bar on
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo ERROR: pip install failed. Try running manually to see details:
    echo   "%EMB_ROOT%\venv\Scripts\python.exe" -m pip install -r "%EMB_ROOT%\requirements.txt"
    pause
    exit /b 1
)
echo OK: Dependencies installed

echo.
echo ========================================
echo Embedding environment setup complete!
echo Venv location: %EMB_ROOT%\venv
echo ========================================
echo.
echo Next: Run 02_start_service.bat to start Embedding service
echo.
pause