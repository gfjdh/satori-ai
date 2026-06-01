@echo off
echo ========================================
echo ASR Service - Starting (port 5032)
echo ========================================
echo.

set "ASR_ROOT=%~dp0..\..\services\asr"

cd /d "%ASR_ROOT%"
set "ASR_ROOT=%CD%"

if not exist "%ASR_ROOT%\venv\Scripts\python.exe" (
    echo ERROR: Virtual environment not found. Run 01_setup_env.bat first.
    exit /b 1
)

for /f "tokens=2 delims= " %%v in ('venv\Scripts\python.exe --version 2^>^&1') do echo    Python: %%v
echo    Port:   5032
echo - Health:     http://localhost:5032/api/health
echo - Transcribe: POST http://localhost:5032/api/transcribe
echo.

start "ASR Service" cmd /k "title ASR Service (port 5032) && venv\Scripts\python.exe app.py"

echo ASR service launched. Warmup takes ~8s, then ready on port 5032.
echo.
pause
