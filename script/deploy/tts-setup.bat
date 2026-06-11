@echo off
cd /d "%~dp0"
set "HERE=%~dp0..\services\tts"
echo Setting up TTS...
"..\runtime\python-3.13\pythonw.exe" -m pip install -r "%HERE%\requirements.txt" --target "%HERE%\packages" --find-links "..\wheels" -i https://pypi.tuna.tsinghua.edu.cn/simple
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: pip install failed for TTS
    exit /b 1
)
echo OK > "%HERE%\.setup_done"
echo TTS setup complete.
echo.
echo Downloading BERT/HuBERT models from HuggingFace...
"..\runtime\python-3.13\python.exe" "%HERE%\download_models.py"
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Model download failed for TTS
    del "%HERE%\.setup_done" 2>nul
    exit /b 1
)
echo TTS models ready.
