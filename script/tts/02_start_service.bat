@echo off
echo ========================================
echo TTS Service - Starting (port 5030)
echo ========================================
echo.

set "TTS_ROOT=%~dp0..\..\tts-service"

echo Starting TTS service (this may take a while for model loading)...
echo - TTS API:  http://localhost:5030/api
echo - Health:   http://localhost:5030/api/health
echo.

start "TTS Service" cmd /k "cd /d "%TTS_ROOT%" && venv\Scripts\python.exe app.py"

echo.
echo TTS service is starting in a new window...
echo Note: First run will download/load models, please wait.
echo.
pause