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
echo [1/7] Backend (Node.js)...
cd /d "%~dp0backend"
call 01_setup_env.bat
if errorlevel 1 (
    set /a FAILURES+=1
    echo ERROR: Backend setup failed
)
echo.

:: WebUI
echo [2/7] WebUI (Node.js)...
cd /d "%~dp0webui"
call 01_setup_env.bat
if errorlevel 1 (
    set /a FAILURES+=1
    echo ERROR: WebUI setup failed
)
echo.

:: TTS
echo [3/7] TTS Service (Python)...
cd /d "%~dp0tts"
call 01_setup_env.bat
if errorlevel 1 (
    set /a FAILURES+=1
    echo ERROR: TTS setup failed
)
echo.

:: Embedding
echo [4/7] Embedding Service (Python)...
cd /d "%~dp0embedding"
call 01_setup_env.bat
if errorlevel 1 (
    set /a FAILURES+=1
    echo ERROR: Embedding setup failed
)
echo.

:: Image
echo [5/7] Image Service (Python)...
cd /d "%~dp0image"
call 01_setup_env.bat
if errorlevel 1 (
    set /a FAILURES+=1
    echo ERROR: Image setup failed
)
echo.

:: Browser
echo [6/7] Browser Service (Python)...
cd /d "%~dp0browser"
call 01_setup_env.bat
if errorlevel 1 (
    set /a FAILURES+=1
    echo ERROR: Browser setup failed
)
echo.

:: Live2D (uses system Python)
echo [7/7] Live2D Launcher (system Python)...
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
echo Next: Run services via start.ps1 for interactive menu
echo         or run individual 02_start_service.bat scripts
echo.
pause
