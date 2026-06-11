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

# ============================================================
# Helper: pip with mirror fallback (Tsinghua -> Aliyun -> PyPI)
# --retries 1 for fast failure (~3s per mirror instead of ~50s)
# ============================================================
function Invoke-Pip {
    param(
        [Parameter(Mandatory=$true)]
        [string]$Python,
        [Parameter(Mandatory=$true)]
        [string[]]$PipArgs
    )
    $mirrors = @(
        "https://pypi.tuna.tsinghua.edu.cn/simple",
        "https://mirrors.aliyun.com/pypi/simple",
        "https://pypi.org/simple"
    )
    foreach ($mirror in $mirrors) {
        & $Python -m pip @PipArgs -i $mirror --retries 1
        if ($LASTEXITCODE -eq 0) { return $true }
        Write-Host "  Mirror failed: $mirror" -ForegroundColor Yellow
    }
    Write-Host "  All mirrors unreachable" -ForegroundColor Red
    return $false
}

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
        # Extract better-sqlite3 version from source package.json via regex
        # (regex avoids ConvertFrom-Json encoding issues with CJK characters)
        $srcPkgJson = Join-Path $projectRoot "package.json"
        $srcPkgRaw = Get-Content $srcPkgJson -Raw -Encoding UTF8
        $bs3Version = if ($srcPkgRaw -match '"better-sqlite3"\s*:\s*"([^"]+)"') { $matches[1] } else { $null }
        if (-not $bs3Version) { throw "better-sqlite3 not found in package.json dependencies" }

        # Create minimal package.json with ONLY better-sqlite3,
        # so npm doesn't install the full 306-package dependency tree
        # and doesn't walk up to the project root package.json.
        $realPkgJson = Join-Path $pkgDir "package.json"
        $realPkgBak = Join-Path $pkgDir "package.json.bak"
        Move-Item $realPkgJson $realPkgBak
        try {
            $minimalPkg = @{
                name = "satori-bundle"
                private = $true
                dependencies = @{ "better-sqlite3" = $bs3Version }
            }
            $minimalPkg | ConvertTo-Json | Out-File -FilePath $realPkgJson -Encoding utf8
            & $bundledNode $bundledNpm install
        } finally {
            Move-Item -Force $realPkgBak $realPkgJson
        }
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

# Upgrade pip + install build tools into embedded Pythons
# Old pip versions can't resolve cp313 wheel tags, causing false fallback to source builds.
# maturin is the build backend for Rust-based packages (tokenizers, safetensors, etc.).
foreach ($pyVer in @("3.13", "3.12")) {
    $pyExe = Join-Path $pkgDir "runtime\python-$pyVer\python.exe"
    if (Test-Path $pyExe) {
        Write-Host "  Upgrading pip + installing build tools into Python $pyVer..."
        Invoke-Pip -Python $pyExe -PipArgs @("install", "-q", "--no-cache-dir", "--upgrade", "pip") | Out-Null
        Invoke-Pip -Python $pyExe -PipArgs @("install", "-q", "--no-cache-dir", "setuptools", "wheel", "maturin", "puccinialin") | Out-Null
        if ($LASTEXITCODE -ne 0) {
            Write-Warning "  build tools install failed for Python $pyVer"
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
        $wheelArgs = @("wheel") + $pkgs + @("-w", $wheelsDst, "--no-deps")
        Invoke-Pip -Python $py313 -PipArgs $wheelArgs | Out-Null
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
        Invoke-Pip -Python $py312 -PipArgs @("wheel", "jieba-fast==0.53", "-w", $wheelsDst, "--no-deps") | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "pip wheel failed for cp312: jieba-fast" }
    }
    if ($needJieba) {
        Write-Host "    cp312: jieba==0.42.1..."
        Invoke-Pip -Python $py312 -PipArgs @("wheel", "jieba==0.42.1", "-w", $wheelsDst, "--no-deps") | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "pip wheel failed for cp312: jieba" }
    }
    if (-not $needJiebaFast312 -and -not $needJieba) {
        Write-Host "    cp312: wheels already exist, skipped" -ForegroundColor Green
    }
} else {
    Write-Warning "  Python 3.12 runtime not found, skipping cp312 wheel build"
}

# Download pre-built wheels for Rust-based packages (tokenizers, safetensors).
# These are pure downloads -- no Rust toolchain required at setup time.
# Without pre-built wheels, pip falls back to source build → maturin → puccinialin
# → downloads Rust from static.rust-lang.org (fails in offline/DNS-restricted VMs).
Write-Host "  Downloading Rust-based package wheels..."
if (Test-Path $py313) {
    if (-not (Test-WheelExists "tokenizers-*-cp313-*.whl")) {
        Write-Host "    Downloading tokenizers wheel for cp313..."
        Invoke-Pip -Python $py313 -PipArgs @("download", "tokenizers", "-d", $wheelsDst, "--only-binary", ":all:", "--no-deps") | Out-Null
        if ($LASTEXITCODE -ne 0) {
            throw "tokenizers wheel download failed -- need network to pre-download Rust package"
        }
    }
    if (-not (Test-WheelExists "safetensors-*-cp313-*.whl")) {
        Write-Host "    Downloading safetensors wheel for cp313..."
        Invoke-Pip -Python $py313 -PipArgs @("download", "safetensors", "-d", $wheelsDst, "--only-binary", ":all:", "--no-deps") | Out-Null
        if ($LASTEXITCODE -ne 0) {
            throw "safetensors wheel download failed -- need network to pre-download Rust package"
        }
    }
    if ((Test-WheelExists "tokenizers-*-cp313-*.whl") -and (Test-WheelExists "safetensors-*-cp313-*.whl")) {
        Write-Host "    Rust package wheels ready" -ForegroundColor Green
    }
} else {
    Write-Warning "  Python 3.13 not found, skipping Rust wheel download"
}

# 3.14: Copy open_jtalk dictionary from source venv → package
# pyopenjtalk lazy-downloads this ~103MB dict from GitHub on first use.
# We bundle the pre-extracted copy so VM setup doesn't need to reach github.com.
Write-Host "  Copying open_jtalk dictionary..."
$ojDictSrc = Join-Path $projectRoot "services\tts\venv\Lib\site-packages\pyopenjtalk\open_jtalk_dic_utf_8-1.11"
$ojDictDst = Join-Path $pkgDir "services\tts\open_jtalk_dic_utf_8-1.11"
if (Test-Path $ojDictSrc) {
    robocopy $ojDictSrc $ojDictDst /E /NFL /NDL /NJH /NJS
    if ($LASTEXITCODE -ge 8) { throw "open_jtalk dictionary copy failed" }
    Write-Host "    open_jtalk dictionary bundled" -ForegroundColor Green
} else {
    Write-Warning "  open_jtalk dict not found in venv. Run TTS in dev mode once to auto-download it, then rebuild."
}

# 3.15: Playwright browsers are downloaded on first setup (browser-setup.bat)
# No longer bundled in the distribution package (~685MB savings)
Write-Host "  Playwright browsers: will be downloaded on first setup" -ForegroundColor Green

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host " Build Complete!" -ForegroundColor Green
Write-Host " Output: $pkgDir" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
