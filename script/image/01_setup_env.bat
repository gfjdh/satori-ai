@echo off
echo ========================================
echo Image Analysis Service - Environment Setup
echo ========================================
echo.

set "IMG_ROOT=%~dp0..\..\services\image"

cd /d "%IMG_ROOT%"
set "IMG_ROOT=%CD%"

echo [Info] Image service root: %IMG_ROOT%
echo.

if not exist "%IMG_ROOT%" (
    echo ERROR: Image service directory not found: %IMG_ROOT%
    exit /b 1
)

echo [1/2] Checking virtual environment...
if not exist "%IMG_ROOT%\venv\Scripts\python.exe" (
    echo Creating virtual environment...
    python -m venv "%IMG_ROOT%\venv"
)
echo OK: Virtual environment ready

echo.
echo [2/2] Installing dependencies...
call "%IMG_ROOT%\venv\Scripts\python.exe" -m pip install -r "%IMG_ROOT%\requirements.txt"
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Failed to install dependencies
    exit /b 1
)
echo OK: Dependencies installed

echo.
echo ========================================
echo Image Analysis environment setup complete!
echo Venv location: %IMG_ROOT%\venv
echo ========================================
echo.
echo Next: Run 02_start_service.bat to start Image service
echo.
pause
