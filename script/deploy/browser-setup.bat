@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"
set "HERE=%~dp0..\services\browser"
echo Setting up Browser...
"..\runtime\python-3.13\pythonw.exe" -m pip install -r "%HERE%\requirements.txt" --target "%HERE%\packages" --find-links "..\wheels" -i https://pypi.tuna.tsinghua.edu.cn/simple
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
