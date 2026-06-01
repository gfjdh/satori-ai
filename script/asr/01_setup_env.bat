@echo off
setlocal enabledelayedexpansion
echo ========================================
echo ASR Service - Environment Setup
echo ========================================
echo.

set "ASR_ROOT=%~dp0..\..\services\asr"

cd /d "%ASR_ROOT%"
set "ASR_ROOT=%CD%"

echo [Info] ASR service root: %ASR_ROOT%
echo.

if not exist "%ASR_ROOT%" (
    echo ERROR: ASR service directory not found: %ASR_ROOT%
    exit /b 1
)

:: --- Python version gate: numpy has no MSVC wheel for 3.13+ on Windows ---
set "PYTHON_EXE=python"

:: Prefer Python 3.12 if installed at standard location
if exist "C:\Users\%USERNAME%\AppData\Local\Programs\Python\Python312\python.exe" (
    set "PYTHON_EXE=C:\Users\%USERNAME%\AppData\Local\Programs\Python\Python312\python.exe"
)

for /f "tokens=2 delims= " %%v in ('"!PYTHON_EXE!" --version 2^>^&1') do set "PYTHON_VER=%%v"
echo [Info] Python: !PYTHON_EXE! (version !PYTHON_VER!)

for /f "tokens=2 delims=." %%a in ("!PYTHON_VER!") do set "PYTHON_MINOR=%%a"
if !PYTHON_MINOR! GEQ 13 (
    echo ERROR: Python 3.13+ is not supported on Windows.
    echo        numpy has no MSVC wheel for Python 3.13 - it will crash on import.
    echo        Install Python 3.12 from https://www.python.org/downloads/
    echo        Expected: C:\Users\%USERNAME%\AppData\Local\Programs\Python\Python312\python.exe
    exit /b 1
)

:: --- Rebuild venv if Python version changed ---
if exist "%ASR_ROOT%\venv\Scripts\python.exe" (
    "%ASR_ROOT%\venv\Scripts\python.exe" -c "import sys; sys.exit(0 if sys.version.startswith('!PYTHON_VER!') else 1)" 2>nul
    if !ERRORLEVEL! NEQ 0 (
        echo [Info] Venv Python version changed, rebuilding...
        rmdir /s /q "%ASR_ROOT%\venv"
    )
)

echo [1/3] Checking virtual environment...
if not exist "%ASR_ROOT%\venv\Scripts\python.exe" (
    echo Creating virtual environment with Python !PYTHON_VER!...
    "!PYTHON_EXE!" -m venv "%ASR_ROOT%\venv"
    if !ERRORLEVEL! NEQ 0 (
        echo ERROR: Failed to create virtual environment
        exit /b 1
    )
    echo OK: Virtual environment created
) else (
    echo OK: Virtual environment ready
)

echo.
echo [2/3] Installing dependencies...
call "%ASR_ROOT%\venv\Scripts\python.exe" -m pip install -r "%ASR_ROOT%\requirements.txt"
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Failed to install dependencies
    exit /b 1
)
echo OK: Dependencies installed

echo.
echo [3/3] Downloading SenseVoice model (~900MB, one-time)...
call "%ASR_ROOT%\venv\Scripts\python.exe" -c "import sys; sys.path.insert(0, '%ASR_ROOT%'); from api.routes import _download_model; _download_model()"
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Model download failed
    echo You can re-run this script to retry, or manually delete %ASR_ROOT%\models to force re-download
    exit /b 1
)
echo OK: Model downloaded

echo.
echo ========================================
echo ASR environment setup complete!
echo Venv location: %ASR_ROOT%\venv
echo Model location: %ASR_ROOT%\models
echo ========================================
echo.
echo Next: Run 02_start_service.bat to start ASR service
echo.
pause
