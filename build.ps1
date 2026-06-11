# Satori AI Build Script
# Assembles the full distribution package: pkg/Satori-AI/
param(
    [switch]$SkipBackend,
    [switch]$SkipWebUI,
    [switch]$SkipLauncher,
    [switch]$NoZip
)

$ErrorActionPreference = "Stop"
$projectRoot = $PSScriptRoot
$pkgDir = Join-Path $projectRoot "pkg\Satori-AI"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host " Satori AI - Build Pipeline" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# ============================================================
# Step 0: Build Backend (TypeScript → dist/)
# ============================================================
if (-not $SkipBackend) {
    Write-Host "--- Step 0: Build Backend ---" -ForegroundColor Yellow
    Push-Location $projectRoot
    try {
        Write-Host "  esbuild src/index.ts → dist/index.js"
        npx esbuild src/index.ts --bundle --platform=node --outfile=dist/index.js --format=cjs
        if ($LASTEXITCODE -ne 0) { throw "esbuild failed" }

        # Clean dev artifacts
        Get-ChildItem dist -Filter *.d.ts -Recurse | Remove-Item -Force
        Get-ChildItem dist -Filter *.map -Recurse | Remove-Item -Force
        Write-Host "  Backend build OK" -ForegroundColor Green
    } finally {
        Pop-Location
    }
}

# ============================================================
# Step 1: Build Satori WebUI (Vue 3 → webui/dist/)
# ============================================================
if (-not $SkipWebUI) {
    Write-Host "--- Step 1: Build Satori WebUI ---" -ForegroundColor Yellow
    Push-Location (Join-Path $projectRoot "webui")
    try {
        Write-Host "  npm run build"
        npm run build
        if ($LASTEXITCODE -ne 0) { throw "Vite build failed" }
        if (-not (Test-Path "serve.cjs")) {
            Write-Warning "  serve.cjs not found in webui/, copying from launcher template..."
            Copy-Item (Join-Path $projectRoot "launcher\webui\serve.cjs") "serve.cjs" -ErrorAction SilentlyContinue
        }
        Write-Host "  WebUI build OK" -ForegroundColor Green
    } finally {
        Pop-Location
    }
}

# ============================================================
# Step 2: Build Launcher (WebUI Vite + Go build)
# ============================================================
if (-not $SkipLauncher) {
    Write-Host "--- Step 2: Build Launcher ---" -ForegroundColor Yellow

    # 2a: Launcher WebUI
    $launcherWebUI = Join-Path $projectRoot "launcher\webui"
    if (Test-Path (Join-Path $launcherWebUI "package.json")) {
        Push-Location $launcherWebUI
        try {
            Write-Host "  npm install"
            npm install
            Write-Host "  npm run build"
            npm run build
            if ($LASTEXITCODE -ne 0) { throw "Launcher WebUI build failed" }
            Write-Host "  Launcher WebUI build OK" -ForegroundColor Green
        } finally {
            Pop-Location
        }
    }

    # 2b: Go build
    $launcherDir = Join-Path $projectRoot "launcher"
    Write-Host "  go build -o Satori-Launcher.exe"
    Push-Location $launcherDir
    try {
        $webuiDist = Join-Path $launcherDir "webui\dist"
        if (-not (Test-Path (Join-Path $webuiDist "index.html"))) {
            Write-Warning "  Launcher webui/dist/ not found, creating placeholder..."
            New-Item -ItemType Directory -Force -Path $webuiDist | Out-Null
            "<html><body><h1>Satori Launcher</h1></body></html>" | Out-File -FilePath (Join-Path $webuiDist "index.html") -Encoding utf8
        }
        go mod tidy
        go build -ldflags "-s -w -H windowsgui" -o Satori-Launcher.exe .
        if ($LASTEXITCODE -ne 0) { throw "Go build failed" }
        Write-Host "  Launcher build OK ($((Get-Item Satori-Launcher.exe).Length / 1MB) MB)" -ForegroundColor Green
    } finally {
        Pop-Location
    }
}

# ============================================================
# Step 3: Assemble pkg/Satori-AI/
# ============================================================
Write-Host "--- Step 3: Assemble pkg/Satori-AI/ ---" -ForegroundColor Yellow

# 3.1: Prepare pkg directory (preserve runtime/ and wheels/ if they exist)
if (-not (Test-Path $pkgDir)) {
    New-Item -ItemType Directory -Force -Path $pkgDir | Out-Null
}
$preserveDirs = @("runtime", "wheels")
# Clean pkg (skip preserved dirs in-place — never move, zero data-loss risk)
Get-ChildItem $pkgDir | ForEach-Object {
    if ($preserveDirs -notcontains $_.Name) {
        Remove-Item -Recurse -Force $_.FullName
    }
}

# 3.2: Copy Launcher exe
Write-Host "  Copying Satori-Launcher.exe..."
Copy-Item (Join-Path $projectRoot "launcher\Satori-Launcher.exe") $pkgDir

# 3.3: Copy backend dist/
Write-Host "  Copying dist/..."
$distSrc = Join-Path $projectRoot "dist"
if (Test-Path $distSrc) {
    robocopy $distSrc (Join-Path $pkgDir "dist") /E /NFL /NDL /NJH /NJS /XF *.d.ts *.map
}

# 3.4: Copy package.json + .env.example (must precede npm install)
Write-Host "  Copying config files..."
Copy-Item (Join-Path $projectRoot "package.json") $pkgDir -Force
$envExample = Join-Path $projectRoot ".env.example"
if (Test-Path $envExample) {
    Copy-Item $envExample $pkgDir -Force
} else {
    @"
# LLM API
LLM_API_KEY=sk-your-key-here
LLM_BASE_URL=https://api.openai.com/v1
LLM_MODEL=gpt-4
LLM_TEMPERATURE=0.7

# Vision LLM
VISION_LLM_API_KEY=sk-your-key-here
VISION_LLM_BASE_URL=https://api.openai.com/v1
VISION_LLM_MODEL=gpt-4-vision-preview
VISION_LLM_TEMPERATURE=0.7

# Server
PORT=3682

# Browser
BROWSER_HEADLESS=false

# Character
CURRENT_CHARACTER_ID=satori

# TTS / ASR
TTS_SERVICE_HOST=127.0.0.1
TTS_SERVICE_PORT=5030
ASR_SERVICE_HOST=127.0.0.1
ASR_SERVICE_PORT=5032
"@ | Out-File -FilePath (Join-Path $pkgDir ".env.example") -Encoding utf8
}

# 3.5: Install better-sqlite3 native module matching bundled Node runtime
Write-Host "  Installing better-sqlite3 for bundled Node..."
$bundledNode = Join-Path $pkgDir "runtime\node\node.exe"
$bundledNpm = Join-Path $pkgDir "runtime\node\node_modules\npm\bin\npm-cli.js"

if ((Test-Path $bundledNode) -and (Test-Path $bundledNpm)) {
    Push-Location $pkgDir
    try {
        # prebuild-install fetches the correct prebuilt binary for bundled Node version
        & $bundledNode $bundledNpm install better-sqlite3
        if ($LASTEXITCODE -ne 0) {
            Write-Warning "  better-sqlite3 install failed - backend may not start with bundled Node"
        } else {
            # Copy .node to pkg root build/Release/ where esbuild-bundled bindings resolves it
            $bs3Node = Join-Path $pkgDir "node_modules\better-sqlite3\build\Release\better_sqlite3.node"
            $pkgBuildRelease = Join-Path $pkgDir "build\Release"
            if (Test-Path $bs3Node) {
                New-Item -ItemType Directory -Force -Path $pkgBuildRelease | Out-Null
                Copy-Item $bs3Node $pkgBuildRelease -Force
                Write-Host "    better-sqlite3 ready for bundled Node" -ForegroundColor Green
            } else {
                Write-Warning "  better-sqlite3.node not found after install"
            }
            # node_modules is dead weight — esbuild already bundled all JS into dist/index.js
            # Native .node binaries are preserved at build/Release/
            Remove-Item -Recurse -Force (Join-Path $pkgDir "node_modules") -ErrorAction SilentlyContinue
            Remove-Item -Force (Join-Path $pkgDir "package-lock.json") -ErrorAction SilentlyContinue
            Write-Host "    Cleaned npm artifacts" -ForegroundColor Green
        }
    } finally {
        Pop-Location
    }
} else {
    Write-Warning "  Bundled Node/npm not found, skipping better-sqlite3 setup"
}

# 3.5b: Mark Backend as pre-installed (esbuild bundle + native .node already done)
Write-Host "  Creating dist/.setup_done (Backend pre-installed)..."
"pre-installed" | Out-File -FilePath (Join-Path $pkgDir "dist\.setup_done") -Encoding utf8

# 3.6: Copy webui/dist/ + serve.cjs
Write-Host "  Copying webui/..."
$webuiSrc = Join-Path $projectRoot "webui"
if (Test-Path $webuiSrc) {
    $webuiDst = Join-Path $pkgDir "webui"
    New-Item -ItemType Directory -Force -Path $webuiDst | Out-Null
    Copy-Item (Join-Path $webuiSrc "dist") $webuiDst -Recurse -Force
    if (Test-Path (Join-Path $webuiSrc "serve.cjs")) {
        Copy-Item (Join-Path $webuiSrc "serve.cjs") $webuiDst
    }
    # Mark WebUI as pre-installed (serve.cjs has zero external deps)
    "pre-installed" | Out-File -FilePath (Join-Path $webuiDst ".setup_done") -Encoding utf8
    Write-Host "    WebUI pre-installed" -ForegroundColor Green
}

# 3.7: Copy services/
Write-Host "  Copying services/..."
$svcSrc = Join-Path $projectRoot "services"
$svcDst = Join-Path $pkgDir "services"
robocopy $svcSrc $svcDst /E /NFL /NDL /NJH /NJS /XD venv __pycache__ pretrained_models .lock output packages
# Remove large downloaded ASR models (not Python source code — gpt_sovits/AR/models/ is 121KB of source)
$asrModels = Join-Path $svcDst "asr\models"
if (Test-Path $asrModels) { Remove-Item -Recurse -Force $asrModels }

# 3.8: Copy TTS checkpoint files and HuggingFace models
Write-Host "  Copying TTS models..."
$ttsPretrained = Join-Path $projectRoot "services\tts\pretrained_models"
$ttsPretrainedDst = Join-Path $pkgDir "services\tts\pretrained_models"
New-Item -ItemType Directory -Force -Path $ttsPretrainedDst | Out-Null
$ttsCheckpoints = @(
    "s2D488k.pth",
    "s2G488k.pth",
    "s1bert25hz-2kh-longer-epoch=68e-step=50232.ckpt"
)
foreach ($cp in $ttsCheckpoints) {
    $cpFull = Join-Path $ttsPretrained $cp
    if (Test-Path $cpFull) {
        Copy-Item $cpFull $ttsPretrainedDst -Force
        Write-Host "    $cp"
    }
}

# 3.9: Copy live2d-widget/
Write-Host "  Copying live2d-widget/..."
$l2dSrc = Join-Path $projectRoot "live2d-widget"
$l2dDst = Join-Path $pkgDir "live2d-widget"
robocopy $l2dSrc $l2dDst /E /NFL /NDL /NJH /NJS /XD __pycache__

# 3.10: Copy character-cards/
Write-Host "  Copying character-cards/..."
$ccSrc = Join-Path $projectRoot "character-cards"
if (Test-Path $ccSrc) {
    robocopy $ccSrc (Join-Path $pkgDir "character-cards") /E /NFL /NDL /NJH /NJS
}

# 3.11: Copy script/deploy/*.bat → script/ (overwrites old dev scripts)
Write-Host "  Copying script/*.bat..."
$scriptDeploySrc = Join-Path $projectRoot "script\deploy"
$scriptDst = Join-Path $pkgDir "script"
New-Item -ItemType Directory -Force -Path $scriptDst | Out-Null
if (Test-Path $scriptDeploySrc) {
    Copy-Item (Join-Path $scriptDeploySrc "*-setup.bat") $scriptDst -Force -ErrorAction SilentlyContinue
    Copy-Item (Join-Path $scriptDeploySrc "*-start.bat") $scriptDst -Force -ErrorAction SilentlyContinue
}

# 3.12: Runtime activation (first-time setup)
Write-Host "  Checking runtime/..."
$runtimeDir = Join-Path $pkgDir "runtime"
if (-not (Test-Path $runtimeDir)) {
    Write-Warning "  runtime/ directory not found. It should be pre-built separately."
    Write-Warning "  See launcher/docs/launcher-requirements.md section on embedded Python activation."
}

# Install setuptools+wheel into embedded Pythons (required for source builds)
foreach ($pyVer in @("3.13", "3.12")) {
    $pyExe = Join-Path $pkgDir "runtime\python-$pyVer\python.exe"
    if (Test-Path $pyExe) {
        Write-Host "  Installing setuptools+wheel into Python $pyVer..."
        & $pyExe -m pip install --no-cache-dir setuptools wheel -i https://pypi.tuna.tsinghua.edu.cn/simple 2>&1 | Out-Null
        if ($LASTEXITCODE -ne 0) {
            Write-Warning "  setuptools install failed for Python $pyVer"
        }
    }
}

# 3.13: Build C extension wheels (skip if already built)
Write-Host "  Building C extension wheels..."
$wheelsDst = Join-Path $pkgDir "wheels"
New-Item -ItemType Directory -Force -Path $wheelsDst | Out-Null

# Helper: test if a wheel matching the given pattern already exists
function Test-WheelExists($pattern) {
    $existing = Get-ChildItem $wheelsDst -Filter $pattern -ErrorAction SilentlyContinue
    return ($null -ne $existing -and $existing.Count -gt 0)
}

$pipMirror = "https://pypi.tuna.tsinghua.edu.cn/simple"

# cp313: pyopenjtalk + jieba-fast
$py313 = Join-Path $pkgDir "runtime\python-3.13\python.exe"
if (Test-Path $py313) {
    $needPyopenjtalk = -not (Test-WheelExists "pyopenjtalk-0.4.1-*.whl")
    $needJiebaFast313 = -not (Test-WheelExists "jieba_fast-0.53-cp313-*.whl")

    if ($needPyopenjtalk -or $needJiebaFast313) {
        $pkgs = @()
        if ($needPyopenjtalk) { $pkgs += "pyopenjtalk==0.4.1" }
        if ($needJiebaFast313) { $pkgs += "jieba-fast==0.53" }
        Write-Host "    cp313: $($pkgs -join ', ')..."
        & $py313 -m pip wheel $pkgs -w $wheelsDst --no-deps -i $pipMirror
        if ($LASTEXITCODE -ne 0) { throw "pip wheel failed for cp313: $($pkgs -join ', ')" }
    } else {
        Write-Host "    cp313: wheels already exist, skipped" -ForegroundColor Green
    }
} else {
    Write-Warning "  Python 3.13 runtime not found, skipping cp313 wheel build"
}

# cp312: jieba-fast + jieba
$py312 = Join-Path $pkgDir "runtime\python-3.12\python.exe"
if (Test-Path $py312) {
    $needJiebaFast312 = -not (Test-WheelExists "jieba_fast-0.53-cp312-*.whl")
    $needJieba = -not (Test-WheelExists "jieba-0.42.1-*.whl")

    if ($needJiebaFast312) {
        Write-Host "    cp312: jieba-fast==0.53..."
        & $py312 -m pip wheel jieba-fast==0.53 -w $wheelsDst --no-deps -i $pipMirror
        if ($LASTEXITCODE -ne 0) { throw "pip wheel failed for cp312: jieba-fast" }
    }
    if ($needJieba) {
        Write-Host "    cp312: jieba==0.42.1..."
        & $py312 -m pip wheel jieba==0.42.1 -w $wheelsDst --no-deps -i $pipMirror
        if ($LASTEXITCODE -ne 0) { throw "pip wheel failed for cp312: jieba" }
    }
    if (-not $needJiebaFast312 -and -not $needJieba) {
        Write-Host "    cp312: wheels already exist, skipped" -ForegroundColor Green
    }
} else {
    Write-Warning "  Python 3.12 runtime not found, skipping cp312 wheel build"
}

# 3.14: Playwright browsers are downloaded on first setup (browser-setup.bat)
# No longer bundled in the distribution package (~685MB savings)
Write-Host "  Playwright browsers: will be downloaded on first setup" -ForegroundColor Green

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host " Build Complete!" -ForegroundColor Green
Write-Host " Output: $pkgDir" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
