@echo off
echo ========================================
echo TTS Service - Starting (port 5030)
echo ========================================
echo.

cd /d "%~dp0"

echo Starting Flask service (standalone mode)...
start "TTS Service" cmd /k "venv\Scripts\python.exe app.py"

echo.
echo TTS Service starting...
timeout /t 3 /nobreak >nul

echo.
echo Checking port 5030...
netstat -ano | findstr ":5030"
if errorlevel 1 (
    echo WARNING: Port 5030 not detected
)

echo.
echo Done!
echo.
echo API: http://127.0.0.1:5030/api
echo Health: http://127.0.0.1:5030/api/health
echo.
