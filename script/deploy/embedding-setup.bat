@echo off
cd /d "%~dp0"
set "HERE=%~dp0..\services\embedding"
echo Setting up Embedding...
"..\runtime\python-3.13\pythonw.exe" -m pip install -r "%HERE%\requirements.txt" --target "%HERE%\packages" --find-links "..\wheels" -i https://pypi.tuna.tsinghua.edu.cn/simple
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: pip install failed for Embedding
    exit /b 1
)
echo OK > "%HERE%\.setup_done"
echo Embedding packages installed.
echo.
echo Downloading bert-base-chinese model from HuggingFace...
"..\runtime\python-3.13\python.exe" "%HERE%\download_models.py"
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Model download failed for Embedding
    del "%HERE%\.setup_done" 2>nul
    exit /b 1
)
echo Embedding setup complete.
