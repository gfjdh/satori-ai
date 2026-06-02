@echo off
echo ========================================
echo TTS Service - Environment Setup
echo ========================================
echo.

set "TTS_ROOT=%~dp0..\..\services\tts"

cd /d "%TTS_ROOT%"
set "TTS_ROOT=%CD%"

echo [Info] TTS service root: %TTS_ROOT%
echo.

if not exist "%TTS_ROOT%" (
    echo ERROR: TTS service directory not found: %TTS_ROOT%
    exit /b 1
)

echo [1/2] Checking virtual environment...
if not exist "%TTS_ROOT%\venv\Scripts\python.exe" (
    echo Creating virtual environment...
    python -m venv "%TTS_ROOT%\venv"
)
echo OK: Virtual environment ready

echo.
echo [2/2] Installing dependencies...
echo [Info] This may take 5-15 minutes on first run (torch is ~2.5GB)...
"%TTS_ROOT%\venv\Scripts\python.exe" -m pip install -r "%TTS_ROOT%\requirements.txt" --progress-bar on
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo ERROR: pip install failed. Try running manually to see details:
    echo   "%TTS_ROOT%\venv\Scripts\python.exe" -m pip install -r "%TTS_ROOT%\requirements.txt"
    pause
    exit /b 1
)
echo OK: Dependencies installed

echo.
echo ========================================
echo TTS environment setup complete!
echo Venv location: %TTS_ROOT%\venv
echo ========================================
echo.
echo Next: Run 02_start_service.bat to start TTS service
echo.
pause