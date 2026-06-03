# Satori AI - Total build & package script
# Produces: pkg\Satori-AI\ (ready-to-distribute directory)
param(
    [switch]$SkipBackend,
    [switch]$SkipWebUI,
    [switch]$SkipLauncher,
    [switch]$Zip,
    [switch]$Help
)

if ($Help) {
    Write-Host @"
Usage: .\build.ps1 [-SkipBackend] [-SkipWebUI] [-SkipLauncher] [-Zip] [-Help]

Full project build: Backend (esbuild) -> Satori WebUI (Vite) -> Launcher (Vue+Go) -> Package

Options:
  -SkipBackend   Skip backend esbuild (use existing dist/)
  -SkipWebUI     Skip Satori WebUI Vite build (use existing webui/dist/)
  -SkipLauncher   Skip Launcher build (use existing Satori-Launcher.exe)
  -Zip           Also create Satori-AI-v1.0.0.zip
  -Help          Show this help message

Output:
  pkg\Satori-AI\                   Ready-to-distribute directory
  pkg\Satori-AI-v1.0.0.zip        (if -Zip)
"@
    exit 0
}

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$pkg = "$root\pkg\Satori-AI"
$version = "1.0.0"

Write-Host "=== Satori AI Total Build v$version ===" -ForegroundColor Cyan
$totalStart = Get-Date

# ────────────────────────────────────────────
# Step 0: Build Backend (esbuild bundle)
# ────────────────────────────────────────────
if (-not $SkipBackend) {
    Write-Host "`n[Step 0/4] Building Backend (esbuild)..." -ForegroundColor Yellow
    Set-Location $root

    if (-not (Test-Path node_modules)) {
        Write-Host "  npm install..."
        npm install
    }

    Write-Host "  esbuild src/index.ts --bundle --platform=node --external:better-sqlite3..."
    npx esbuild src/index.ts --bundle --platform=node --outdir=dist/ --format=cjs --external:better-sqlite3
    if ($LASTEXITCODE -ne 0) { throw "Backend build failed" }
    Write-Host "  Done" -ForegroundColor Green
} else {
    Write-Host "[Step 0/4] Backend: SKIPPED" -ForegroundColor DarkGray
}

# ────────────────────────────────────────────
# Step 1: Build Satori WebUI (Vite -> webui/dist/)
# ────────────────────────────────────────────
if (-not $SkipWebUI) {
    Write-Host "`n[Step 1/4] Building Satori WebUI..." -ForegroundColor Yellow
    Set-Location "$root\webui"

    if (-not (Test-Path node_modules)) {
        Write-Host "  npm install..."
        npm install
    }

    npm run build
    if ($LASTEXITCODE -ne 0) { throw "Satori WebUI build failed" }

    # Verify serve.cjs exists for zero-dependency static serving
    if (-not (Test-Path "$root\webui\serve.cjs")) {
        Write-Host "  WARNING: webui/serve.cjs not found! Creating default..." -ForegroundColor Red
        @'
const { createServer } = require('http');
const { readFile } = require('fs');
const { join, extname } = require('path');
const PORT = 5173;
const DIR = join(__dirname, 'dist');
const MIME = {
  '.html': 'text/html', '.js': 'application/javascript',
  '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2'
};
createServer((req, res) => {
  const file = join(DIR, req.url === '/' ? '/index.html' : req.url.split('?')[0]);
  readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'text/plain' });
    res.end(data);
  });
}).listen(PORT, () => console.log(`WebUI http://localhost:${PORT}`));
'@ | Out-File -FilePath "$root\webui\serve.cjs" -Encoding utf8
    }

    Write-Host "  Done" -ForegroundColor Green
} else {
    Write-Host "[Step 1/4] Satori WebUI: SKIPPED" -ForegroundColor DarkGray
}

# ────────────────────────────────────────────
# Step 2: Build Launcher (Launcher WebUI + Go)
# ────────────────────────────────────────────
if (-not $SkipLauncher) {
    Write-Host "`n[Step 2/4] Building Launcher..." -ForegroundColor Yellow

    # 2a. Launcher WebUI
    Write-Host "  Building Launcher WebUI..."
    Set-Location "$root\launcher\webui"
    if (-not (Test-Path node_modules)) {
        Write-Host "    npm install..."
        npm install
    }
    npm run build
    if ($LASTEXITCODE -ne 0) { throw "Launcher WebUI build failed" }

    # 2b. Go build
    Write-Host "  Building Go..."
    Set-Location "$root\launcher"
    go mod tidy
    go build -ldflags "-s -w -H windowsgui" -o Satori-Launcher.exe .
    if ($LASTEXITCODE -ne 0) { throw "Go build failed" }

    Write-Host "  Done" -ForegroundColor Green
} else {
    Write-Host "[Step 2/4] Launcher: SKIPPED" -ForegroundColor DarkGray
}

# ────────────────────────────────────────────
# Step 3: Package
# ────────────────────────────────────────────
Write-Host "`n[Step 3/4] Packaging..." -ForegroundColor Yellow
Set-Location $root

# Clean and create package directory
Remove-Item -Recurse -Force $pkg -ErrorAction SilentlyContinue
New-Item -Force -ItemType Directory $pkg | Out-Null

# Copy Launcher
Write-Host "  Copying Satori-Launcher.exe..."
$launcherExe = "$root\launcher\Satori-Launcher.exe"
if (-not (Test-Path $launcherExe)) { throw "Satori-Launcher.exe not found. Run without -SkipLauncher first." }
Copy-Item $launcherExe "$pkg\"

# Copy Backend
Write-Host "  Copying dist/..."
if (-not (Test-Path "$root\dist\index.js")) { throw "dist/index.js not found. Run without -SkipBackend first." }
Copy-Item -Recurse "$root\dist\" "$pkg\dist\"
# Remove TypeScript build artifacts (.d.ts, .d.ts.map, .js.map)
Get-ChildItem -Recurse -File -Path "$pkg\dist" -Include "*.d.ts", "*.d.ts.map", "*.js.map" -ErrorAction SilentlyContinue | Remove-Item -Force

# Copy better-sqlite3 (prebuilt .node binary, strip build artifacts)
Write-Host "  Copying better-sqlite3..."
$bsql3 = "$root\node_modules\better-sqlite3"
if (Test-Path $bsql3) {
    Copy-Item -Recurse $bsql3 "$pkg\node_modules\better-sqlite3\"
    # Remove build intermediates: .obj, .lib, .pdb, .iobj, .ipdb, obj/ dir, deps/ build, C source
    $bsqlPkg = "$pkg\node_modules\better-sqlite3"
    Remove-Item -Recurse -Force "$bsqlPkg\build\Release\*.obj", "$bsqlPkg\build\Release\*.lib",
        "$bsqlPkg\build\Release\*.pdb", "$bsqlPkg\build\Release\*.iobj",
        "$bsqlPkg\build\Release\*.ipdb", "$bsqlPkg\build\Release\obj",
        "$bsqlPkg\build\deps", "$bsqlPkg\deps", "$bsqlPkg\src" -ErrorAction SilentlyContinue
}

# Copy Satori WebUI (dist + serve.cjs)
Write-Host "  Copying webui/dist/ + serve.cjs..."
if (-not (Test-Path "$root\webui\dist")) { throw "webui/dist/ not found. Run without -SkipWebUI first." }
Copy-Item -Recurse "$root\webui\dist\" "$pkg\webui\dist\"
Copy-Item "$root\webui\serve.cjs" "$pkg\webui\serve.cjs" -ErrorAction SilentlyContinue

# Copy Python services (source only, no venv/cache/models)
Write-Host "  Copying services/..."
# robocopy with /XD excludes entire directory subtrees at source — never touches venv
$excludeDirs = @("venv", "__pycache__", "pretrained_models", "models", ".lock", "output", "gpt_sovits")
foreach ($svc in Get-ChildItem -Path "$root\services" -Directory) {
    $srcSvc = $svc.FullName
    $dstSvc = "$pkg\services\$($svc.Name)"
    $xdArgs = ($excludeDirs | ForEach-Object { "/XD", $_ })
    robocopy $srcSvc $dstSvc /E /NFL /NDL /NJH /NJS $xdArgs
    if ($LASTEXITCODE -ge 8) { throw "robocopy failed for $($svc.Name)" }
}
# Also strip any ModelScope-downloaded model dirs (iic_* pattern)
Get-ChildItem -Recurse -Directory -Path "$pkg\services" -Filter "iic_*" -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue

# Copy Live2D widget
Write-Host "  Copying live2d-widget/..."
Copy-Item -Recurse "$root\live2d-widget\" "$pkg\live2d-widget\"
Get-ChildItem -Recurse -Directory -Path "$pkg\live2d-widget" -Filter "__pycache__" | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue

# Empty character-cards directory
Write-Host "  Creating character-cards/..."
New-Item -Force -ItemType Directory "$pkg\character-cards" | Out-Null

# Prebuild C-extension wheels (pyopenjtalk, jieba-fast — no prebuilt wheels on PyPI)
Write-Host "  Building precompiled wheels..."
$wheelsDir = "$pkg\wheels"
New-Item -Force -ItemType Directory $wheelsDir | Out-Null
$ttsVenv = "$root\services\tts\venv\Scripts\python.exe"
if (Test-Path $ttsVenv) {
    Write-Host "    Building cp313 wheels via TTS venv..."
    $prevEAP = $ErrorActionPreference; $ErrorActionPreference = "Continue"
    & $ttsVenv -m pip wheel pyopenjtalk==0.4.1 jieba-fast==0.53 -w $wheelsDir --no-deps 2>&1 | Out-Null
    $ErrorActionPreference = $prevEAP
    if ($LASTEXITCODE -ne 0) { Write-Host "    WARNING: cp313 wheel build failed" -ForegroundColor Yellow }
}
$asrVenv = "$root\services\asr\venv\Scripts\python.exe"
if (Test-Path $asrVenv) {
    Write-Host "    Building cp312 wheels via ASR venv..."
    $prevEAP = $ErrorActionPreference; $ErrorActionPreference = "Continue"
    & $asrVenv -m pip wheel jieba-fast==0.53 -w $wheelsDir --no-deps 2>&1 | Out-Null
    $ErrorActionPreference = $prevEAP
    if ($LASTEXITCODE -ne 0) { Write-Host "    WARNING: cp312 wheel build failed" -ForegroundColor Yellow }
}
Write-Host "    Done" -ForegroundColor Green

# Config files
Write-Host "  Copying config files..."
Copy-Item "$root\package.json" "$pkg\"
if (Test-Path "$root\.env.example") {
    Copy-Item "$root\.env.example" "$pkg\"
}

# ────────────────────────────────────────────
# Summary
# ────────────────────────────────────────────
$elapsed = (Get-Date) - $totalStart
Write-Host "`n=== Build Complete ===" -ForegroundColor Green
Write-Host "Output: $pkg" -ForegroundColor White
Write-Host "Elapsed: $($elapsed.TotalSeconds.ToString('0.0'))s" -ForegroundColor White

# Show size
$size = (Get-ChildItem -Recurse -File -Path $pkg | Measure-Object -Property Length -Sum).Sum
Write-Host "Size:   $([math]::Round($size/1MB, 1)) MB" -ForegroundColor White

# Optional: create zip
if ($Zip) {
    Write-Host "`n[Step 4/4] Creating zip..." -ForegroundColor Yellow
    $zipPath = "$root\pkg\Satori-AI-v$version.zip"
    Remove-Item $zipPath -ErrorAction SilentlyContinue
    Compress-Archive -Path "$pkg\*" -DestinationPath $zipPath
    $zipSize = [math]::Round((Get-Item $zipPath).Length / 1MB, 1)
    Write-Host "  $zipPath ($zipSize MB)" -ForegroundColor Green
}
