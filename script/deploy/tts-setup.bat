@echo off
cd /d "%~dp0"
set "HERE=%~dp0..\services\tts"
set "PYTHON=..\runtime\python-3.13\python.exe"

echo Setting up TTS...

:: Step 1: Upgrade pip (old pip versions can't resolve cp313 wheels correctly)
echo [TTS] Upgrading pip...
call :pip_install install --upgrade pip
if %ERRORLEVEL% NEQ 0 (
    echo WARNING: pip upgrade failed, continuing with existing version
)

:: Step 2: Install maturin + puccinialin into embedded Python
:: maturin is the build backend for Rust-based packages (tokenizers, safetensors).
:: puccinialin auto-installs Rust into a temp dir when cargo is not found on the system.
:: Together they allow building Rust packages from source on clean VMs without Rust.
echo [TTS] Installing maturin + puccinialin...
call :pip_install install maturin puccinialin
if %ERRORLEVEL% NEQ 0 (
    echo WARNING: maturin/puccinialin install failed, source builds for Rust packages will fail
)

:: Step 3: Install TTS requirements
echo [TTS] Installing requirements...
call :pip_install install -r "%HERE%\requirements.txt" --target "%HERE%\packages" --find-links "..\wheels"
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: pip install failed for TTS
    exit /b 1
)
:: Step 4: Copy open_jtalk dictionary into pyopenjtalk package dir
:: The dict is pre-bundled by build.ps1 from the source venv.
:: Without this, pyopenjtalk tries to download it from GitHub at runtime.
echo [TTS] Copying open_jtalk dictionary...
set "OJDICT_SRC=%HERE%\open_jtalk_dic_utf_8-1.11"
set "OJDICT_DST=%HERE%\packages\pyopenjtalk\open_jtalk_dic_utf_8-1.11"
if exist "%OJDICT_SRC%" (
    if not exist "%OJDICT_DST%" (
        robocopy "%OJDICT_SRC%" "%OJDICT_DST%" /E /NFL /NDL /NJH /NJS
        if %ERRORLEVEL% GEQ 8 (
            echo WARNING: open_jtalk dictionary copy failed, Japanese TTS may fail
        ) else (
            echo   Dictionary ready
        )
    ) else (
        echo   Dictionary already in place, skipped
    )
) else (
    echo WARNING: open_jtalk dictionary not bundled, Japanese TTS will try to download at runtime
)

:: Step 5: Download ffmpeg.exe for audio processing
:: ffmpeg-python is a wrapper; needs the actual binary on PATH at runtime.
echo [TTS] Downloading ffmpeg.exe...
set "FFMPEG_EXE=%HERE%\ffmpeg.exe"
if not exist "%FFMPEG_EXE%" (
    "%PYTHON%" -c "import urllib.request, zipfile, io; url='https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip'; print('  Downloading ffmpeg...'); r=urllib.request.urlopen(url, timeout=120); z=zipfile.ZipFile(io.BytesIO(r.read())); bins=[n for n in z.namelist() if n.endswith('/ffmpeg.exe')]; open(r'%FFMPEG_EXE%','wb').write(z.read(bins[0])); print('  ffmpeg.exe ready');"
    if %ERRORLEVEL% NEQ 0 (
        echo ERROR: ffmpeg download failed - check network or download manually from https://www.gyan.dev/ffmpeg/builds/
        del "%FFMPEG_EXE%" 2>nul
        exit /b 1
    )
) else (
    echo   ffmpeg.exe already downloaded, skipped
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
