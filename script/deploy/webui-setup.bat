@echo off
cd /d "%~dp0"
set "HERE=%~dp0..\webui"
echo Setting up WebUI...
if exist "%HERE%\serve.cjs" (
    echo serve.cjs found, skipping npm install
) else (
    "..\runtime\node\npm.cmd" install --production --prefix "%HERE%"
    if %ERRORLEVEL% NEQ 0 (
        echo ERROR: npm install failed for WebUI
        exit /b 1
    )
)
echo OK > "%HERE%\.setup_done"
echo WebUI setup complete.
