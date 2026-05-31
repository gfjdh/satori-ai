@echo off
echo ========================================
echo Image Analysis Service - Starting (port 8742)
echo ========================================
echo.

set "IMG_ROOT=%~dp0..\..\services\image"

cd /d "%IMG_ROOT%"
set "IMG_ROOT=%CD%"

if not exist "%IMG_ROOT%\venv\Scripts\python.exe" (
    echo ERROR: Virtual environment not found. Run 01_setup_env.bat first.
    exit /b 1
)

echo Starting Image Analysis service...
echo - Health:   http://localhost:8742/health
echo - Analyze:  http://localhost:8742/analyze
echo - Capture:  http://localhost:8742/capture
echo.

start "Image Service" cmd /k "venv\Scripts\python.exe -m uvicorn app:app --host 0.0.0.0 --port 8742"

echo.
echo Image Analysis service is starting in a new window...
echo Note: First run will initialize the service, please wait.
echo.
pause
