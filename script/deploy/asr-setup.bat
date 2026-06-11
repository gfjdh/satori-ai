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
echo ASR packages installed.
echo.
echo Downloading SenseVoice model from HuggingFace + ModelScope...
"..\runtime\python-3.12\python.exe" "%HERE%\download_models.py"
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Model download failed for ASR
    del "%HERE%\.setup_done" 2>nul
    exit /b 1
)
echo ASR setup complete.
