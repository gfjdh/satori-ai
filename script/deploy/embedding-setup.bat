@echo off
cd /d "%~dp0"
set "HERE=%~dp0..\services\embedding"
set "PYTHON=..\runtime\python-3.13\python.exe"

echo Setting up Embedding...

:: Step 1: Upgrade pip (old pip versions can't resolve cp313 wheels correctly)
echo [Embedding] Upgrading pip...
call :pip_install install --upgrade pip
if %ERRORLEVEL% NEQ 0 (
    echo WARNING: pip upgrade failed, continuing with existing version
)

:: Step 2: Install maturin + puccinialin into embedded Python
echo [Embedding] Installing maturin + puccinialin...
call :pip_install install maturin puccinialin
if %ERRORLEVEL% NEQ 0 (
    echo WARNING: maturin/puccinialin install failed, source builds for Rust packages will fail
)

:: Step 3: Install Embedding requirements
echo [Embedding] Installing requirements...
call :pip_install install -r "%HERE%\requirements.txt" --target "%HERE%\packages" --find-links "..\wheels"
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
exit /b 0

:: ============================================================
:: pip_install: mirror fallback chain (Tsinghua -> Aliyun -> PyPI)
:: --retries 1 for fast failure (~3s per mirror instead of ~50s)
:: ============================================================
:pip_install
    "%PYTHON%" -m pip %* -i https://pypi.tuna.tsinghua.edu.cn/simple --retries 1
    if %ERRORLEVEL% EQU 0 exit /b 0
    echo [WARN] Tsinghua mirror unreachable, trying Aliyun mirror...
    "%PYTHON%" -m pip %* -i https://mirrors.aliyun.com/pypi/simple --retries 1
    if %ERRORLEVEL% EQU 0 exit /b 0
    echo [WARN] Aliyun mirror unreachable, trying PyPI official...
    "%PYTHON%" -m pip %* -i https://pypi.org/simple --retries 1
    if %ERRORLEVEL% EQU 0 exit /b 0
    echo [WARN] All mirrors unreachable, trying offline mode (local wheels only)...
    "%PYTHON%" -m pip %* --no-index --find-links "..\wheels"
    if %ERRORLEVEL% EQU 0 exit /b 0
    echo [ERROR] Offline install failed. Packages missing from wheels/ directory.
    echo [ERROR] Rebuild the package with build.ps1 to pre-download all wheels.
    exit /b 1
