@echo off
echo ========================================
echo WebUI Service - Starting (port 5173)
echo ========================================
echo.

cd /d "%~dp0webui"

echo Starting WebUI service...
echo - WebUI: http://localhost:5173
echo.

start "WebUI Service" cmd /k "npm run dev"

echo.
echo WebUI service is starting in a new window...
echo.
pause