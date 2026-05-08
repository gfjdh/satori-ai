@echo off
echo ========================================
echo Backend Service - Starting (port 3000)
echo ========================================
echo.

cd /d "%~dp0"

setlocal enabledelayedexpansion

:: CURRENT_CHARACTER_ID 由后端 dotenv 自动从 .env 加载，脚本无需干预
echo Character ID: %CURRENT_CHARACTER_ID%
echo.

echo Starting backend service...
echo - Backend: http://localhost:3000
echo - WebUI:   http://localhost:5173
echo.

start "Backend Service" cmd /k "npm run dev"

echo.
echo Backend service is starting in a new window...
echo.
pause