@echo off
cd /d "%~dp0"
set "HERE=%~dp0..\services\image"
echo Setting up Image...
"..\runtime\python-3.13\pythonw.exe" -m pip install -r "%HERE%\requirements.txt" --target "%HERE%\packages" --find-links "..\wheels"
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: pip install failed for Image
    exit /b 1
)
echo OK > "%HERE%\.setup_done"
echo Image setup complete.
