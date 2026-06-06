@echo off
cd /d "%~dp0"
set "ROOT=%~dp0.."
echo Setting up Backend...
"..\runtime\node\npm.cmd" install --production --prefix "%ROOT%"
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: npm install failed for Backend
    exit /b 1
)
echo OK > "%ROOT%\dist\.setup_done"
echo Backend setup complete.
