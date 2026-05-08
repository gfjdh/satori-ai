@echo off
echo ========================================
echo Live2D Launcher - Starting
echo ========================================
echo.

set "PROJECT_ROOT=%~dp0..\.."

cd /d "%PROJECT_ROOT%\live2d-widget"

echo Starting Live2D launcher (no console window)...
echo.

start "" pythonw.exe live2d-launcher.py

echo.
echo Live2D launcher is starting...
echo.
pause
