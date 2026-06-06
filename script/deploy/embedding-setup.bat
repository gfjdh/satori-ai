@echo off
cd /d "%~dp0"
set "HERE=%~dp0..\services\embedding"
echo Setting up Embedding...
"..\runtime\python-3.13\pythonw.exe" -m pip install -r "%HERE%\requirements.txt" --target "%HERE%\packages" --find-links "..\wheels"
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: pip install failed for Embedding
    exit /b 1
)
echo OK > "%HERE%\.setup_done"
echo Embedding setup complete.
