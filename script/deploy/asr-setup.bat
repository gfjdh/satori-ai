@echo off
cd /d "%~dp0"
set "HERE=%~dp0..\services\asr"
echo Setting up ASR...
"..\runtime\python-3.12\pythonw.exe" -m pip install -r "%HERE%\requirements.txt" --target "%HERE%\packages" --find-links "..\wheels"
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: pip install failed for ASR
    exit /b 1
)
echo OK > "%HERE%\.setup_done"
echo ASR setup complete.
echo.
echo Note: SenseVoice model (~900MB) will be downloaded from ModelScope + HuggingFace on first start.
