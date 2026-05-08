@echo off
echo ========================================
echo Satori AI - Setup All Environments
echo ========================================
echo.

cd /d "%~dp0"

set "PROJECT_ROOT=%~dp0.."
set "PROJECT_ROOT=%PROJECT_ROOT:~0,-1%"

echo Project root: %PROJECT_ROOT%
echo.

set "FAILURES=0"

:: Backend
echo [1/5] Backend (Node.js)...
cd /d "%~dp0backend"
call 01_setup_env.bat
if errorlevel 1 (
    set /a FAILURES+=1
    echo ERROR: Backend setup failed
)
echo.

:: WebUI
echo [2/5] WebUI (Node.js)...
cd /d "%~dp0webui"
call 01_setup_env.bat
if errorlevel 1 (
    set /a FAILURES+=1
    echo ERROR: WebUI setup failed
)
echo.

:: TTS
echo [3/5] TTS Service (Python)...
cd /d "%~dp0tts"
call 01_setup_env.bat
if errorlevel 1 (
    set /a FAILURES+=1
    echo ERROR: TTS setup failed
)
echo.

:: Embedding
echo [4/5] Embedding Service (Python)...
cd /d "%~dp0embedding"
call 01_setup_env.bat
if errorlevel 1 (
    set /a FAILURES+=1
    echo ERROR: Embedding setup failed
)
echo.

:: Live2D (uses system Python)
echo [5/5] Live2D Launcher (system Python)...
cd /d "%~dp0live2d"
call 01_setup_env.bat
if errorlevel 1 (
    set /a FAILURES+=1
    echo ERROR: Live2D setup failed
)
echo.

cd /d "%~dp0"

echo ========================================
if %FAILURES%==0 (
    echo   All environments setup complete!
) else (
    echo   Setup completed with %FAILURES% failure(s)
    echo   Please check individual service logs above
)
echo ========================================
echo.
echo Next: Run 00_start_all.bat to start all services
echo       Or use start.ps1 for interactive menu
echo.
pause