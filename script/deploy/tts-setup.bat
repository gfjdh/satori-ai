@echo off
cd /d "%~dp0"
set "HERE=%~dp0..\services\tts"
echo Setting up TTS...
"..\runtime\python-3.13\pythonw.exe" -m pip install -r "%HERE%\requirements.txt" --target "%HERE%\packages" --find-links "..\wheels"
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: pip install failed for TTS
    exit /b 1
)
echo OK > "%HERE%\.setup_done"
echo TTS setup complete.
echo.
echo Note: BERT/HuBERT models will be downloaded on first TTS service start via HuggingFace.
