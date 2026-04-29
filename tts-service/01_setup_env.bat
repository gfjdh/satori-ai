@echo off
echo ========================================
echo TTS Service - Environment Setup
echo ========================================
echo.

cd /d "%~dp0"

echo [1/2] Checking virtual environment...
if not exist "venv\Scripts\python.exe" (
    echo Creating virtual environment...
    python -m venv venv
)
echo OK: Virtual environment ready

echo.
echo [2/2] Installing dependencies...
call venv\Scripts\python.exe -m pip install -r requirements.txt -q
echo OK: Dependencies installed

echo.
echo ========================================
echo Environment setup complete!
echo ========================================
echo.
echo Next: Run 02_start_service.bat to start TTS service
echo.
pause
