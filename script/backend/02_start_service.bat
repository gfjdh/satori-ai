@echo off
echo ========================================
echo Backend Service - Starting (port 3682)
echo ========================================
echo.

set "PROJECT_ROOT=%~dp0..\.."

cd /d "%PROJECT_ROOT%"

setlocal enabledelayedexpansion

echo Starting backend service...
echo - Backend: http://localhost:3682
echo.

start "Backend Service" cmd /k "npm run dev"

echo.
echo Backend service is starting in a new window...
echo.
pause