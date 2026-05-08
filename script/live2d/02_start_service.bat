@echo off
echo ========================================
echo Live2D Launcher - Starting
echo ========================================
echo.

set "PROJECT_ROOT=%~dp0.."

cd /d "%PROJECT_ROOT%\live2d-widget"

echo Starting Live2D launcher (no console window)...
echo.

:: 使用 pythonw.exe 无窗口运行，避免弹出 cmd 窗口
start "" pythonw.exe live2d-launcher.py

echo.
echo Live2D launcher is starting...
echo.
pause
