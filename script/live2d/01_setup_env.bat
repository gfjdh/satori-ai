@echo off
echo ========================================
echo Live2D Launcher - Environment Setup
echo ========================================
echo.

echo [Info] Live2D uses system Python (base environment)
echo [Info] Checking PySide6...

python -c "from PySide6.QtWidgets import QApplication; print('OK: PySide6 ready')" 2>nul
if errorlevel 1 (
    echo ERROR: PySide6 not found in system Python.
    echo Please install: pip install PySide6 PySide6-Addons
    exit /b 1
)

echo.
echo ========================================
echo Live2D environment ready!
echo ========================================
echo.
echo Next: Run 02_start_service.bat to start Live2D launcher
echo.
pause