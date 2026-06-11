@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"
set "HERE=%~dp0..\services\browser"
set "PYTHON=..\runtime\python-3.13\pythonw.exe"
echo Setting up Browser...
call :pip_install install -r "%HERE%\requirements.txt" --target "%HERE%\packages" --find-links "..\wheels"
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: pip install failed for Browser
    exit /b 1
)
echo Installing Playwright Chromium...
set "PLAYWRIGHT_BROWSERS_PATH=%HERE%\browsers"

:: Try local ms-playwright cache first (fast path, no download)
set "LOCAL_PW=%LOCALAPPDATA%\ms-playwright"
if exist "%LOCAL_PW%" (
    echo   Found local Playwright cache, copying...
    robocopy "%LOCAL_PW%" "!PLAYWRIGHT_BROWSERS_PATH!" /E /NFL /NDL /NJH /NJS
    if !ERRORLEVEL! LSS 8 (
        echo   Local cache copied, skipping download
        goto :browser_ready
    )
    echo   Failed to copy local cache, will download
)
echo   Downloading from Playwright CDN...
"..\runtime\python-3.13\pythonw.exe" -c "import sys; sys.path.insert(0, r'!HERE!\packages'); sys.argv = ['playwright', 'install', 'chromium']; import runpy; runpy.run_module('playwright', run_name='__main__')"
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: playwright install chromium failed - check network or set PLAYWRIGHT_DOWNLOAD_HOST
    exit /b 1
)

:browser_ready
echo OK > "%HERE%\.setup_done"
echo Browser setup complete.
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
