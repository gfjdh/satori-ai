@echo off
cd /d "%~dp0"
set "HERE=%~dp0..\services\image"
set "PYTHON=..\runtime\python-3.13\pythonw.exe"
echo Setting up Image...
call :pip_install install -r "%HERE%\requirements.txt" --target "%HERE%\packages" --find-links "..\wheels"
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: pip install failed for Image
    exit /b 1
)
echo OK > "%HERE%\.setup_done"
echo Image setup complete.
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
