@echo off
echo ========================================
echo Embedding Service - Starting (port 7860)
echo ========================================
echo.

set "EMB_ROOT=%~dp0..\..\embedding-service"

cd /d "%EMB_ROOT%"
set "EMB_ROOT=%CD%"

echo Starting Embedding service (bert-base-chinese model will be downloaded on first run)...
echo - Embedding API: http://localhost:7860/encode
echo - Search API:    http://localhost:7860/search
echo - Health:        http://localhost:7860/health
echo.

start "Embedding Service" cmd /k "venv\Scripts\python.exe -m uvicorn main:app --host 0.0.0.0 --port 7860"

echo.
echo Embedding service is starting in a new window...
echo Note: First run will download bert-base-chinese model, please wait.
echo.
pause