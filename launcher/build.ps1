# Satori Launcher - Build & Package Script
# Usage:
#   .\launcher\build.ps1              # Build binary only
#   .\launcher\build.ps1 -Package     # Build + create distribution zip
#   .\launcher\build.ps1 -Clean       # Clean build artifacts

param(
    [switch]$Package,
    [switch]$Clean,
    [switch]$Help
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$launcherDir = "$projectRoot\launcher"
$webuiDir = "$launcherDir\webui"
$binaryName = "Satori-Launcher.exe"
$outputBinary = "$projectRoot\$binaryName"

if ($Help) {
    Write-Host @"
Satori Launcher Build Script
============================
  .\launcher\build.ps1               Build binary to project root
  .\launcher\build.ps1 -Package      Build + create Satori-AI-vX.X.X.zip
  .\launcher\build.ps1 -Clean        Remove build artifacts
"@
    exit 0
}

if ($Clean) {
    Write-Host "[Clean] Removing build artifacts..." -ForegroundColor Yellow
    Remove-Item -Force -ErrorAction SilentlyContinue "$webuiDir\dist\*", "$webuiDir\node_modules", "$outputBinary", "$launcherDir\$binaryName", "$projectRoot\Satori-AI-*.zip"
    Write-Host "[Clean] Done." -ForegroundColor Green
    exit 0
}

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Satori Launcher - Build" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# ---- Check prerequisites ----
Write-Host "[1/4] Checking prerequisites..." -ForegroundColor White

$goVersion = (go version 2>&1)
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Go is not installed. Download from https://go.dev/dl/" -ForegroundColor Red
    exit 1
}
Write-Host "  Go: $goVersion" -ForegroundColor Gray

$nodeVersion = (node --version 2>&1)
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Node.js is not installed." -ForegroundColor Red
    exit 1
}
Write-Host "  Node: $nodeVersion" -ForegroundColor Gray

# ---- Build WebUI ----
Write-Host ""
Write-Host "[2/4] Building WebUI..." -ForegroundColor White

Push-Location $webuiDir

if (-not (Test-Path "node_modules")) {
    Write-Host "  Installing npm dependencies..." -ForegroundColor Gray
    npm install 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Write-Host "ERROR: npm install failed" -ForegroundColor Red
        Pop-Location
        exit 1
    }
}

npm run build 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: WebUI build failed" -ForegroundColor Red
    Pop-Location
    exit 1
}
Pop-Location

$distDir = "$webuiDir\dist"
if (-not (Test-Path "$distDir\index.html")) {
    Write-Host "ERROR: WebUI build output not found at $distDir" -ForegroundColor Red
    exit 1
}
Write-Host "  WebUI built: $distDir" -ForegroundColor Green

# ---- Build Go binary ----
Write-Host ""
Write-Host "[3/4] Building Go binary..." -ForegroundColor White

Push-Location $launcherDir

# Ensure go.sum is up to date
go mod tidy 2>&1 | Out-Null

# Generate Windows resource file (icon) if .ico exists
$icoPath = "$webuiDir\public\favicon.ico"
if (Test-Path $icoPath) {
    Write-Host "  Generating icon resource..." -ForegroundColor Gray
    $rsrc = Get-Command rsrc -ErrorAction SilentlyContinue
    if (-not $rsrc) {
        Write-Host "  Installing rsrc tool..." -ForegroundColor Gray
        go install github.com/akavel/rsrc@latest 2>&1 | Out-Null
    }
    & rsrc -ico $icoPath -o "$launcherDir\rsrc.syso" 2>&1 | Out-Null
    Write-Host "  Icon resource generated" -ForegroundColor Gray
}

$env:GOOS = "windows"
$env:GOARCH = "amd64"
$env:CGO_ENABLED = "0"

go build -ldflags "-s -w -H windowsgui" -o $binaryName . 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Go build failed" -ForegroundColor Red
    Pop-Location
    exit 1
}
Pop-Location

# Copy to project root
Copy-Item -Force "$launcherDir\$binaryName" $outputBinary
$binarySize = [math]::Round((Get-Item $outputBinary).Length / 1MB, 1)
Write-Host "  Binary: $outputBinary ($binarySize MB)" -ForegroundColor Green

# ---- Build complete ----
Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  Build complete!" -ForegroundColor Green
Write-Host "  $outputBinary" -ForegroundColor White
Write-Host "========================================" -ForegroundColor Green

# ---- Package (optional) ----
if (-not $Package) {
    Write-Host ""
    Write-Host "Run with -Package to create distribution zip." -ForegroundColor Gray
    exit 0
}

Write-Host ""
Write-Host "[4/4] Creating distribution package..." -ForegroundColor White

# Get version from git tag or fallback to date
$version = (git -C $projectRoot describe --tags --abbrev=0 2>$null)
if (-not $version) {
    $version = "v" + (Get-Date -Format "yyyy.MM.dd")
}

$packageName = "Satori-AI-$version.zip"
$packagePath = "$projectRoot\$packageName"

# Files to include in the distribution
$include = @(
    "Satori-Launcher.exe",
    "src",
    "services",
    "webui",
    "live2d-widget",
    "script",
    "character-cards",
    "package.json",
    "tsconfig.json",
    ".env.example"
)

# Create temp staging directory
$staging = "$env:TEMP\satori-package"
if (Test-Path $staging) { Remove-Item -Recurse -Force $staging }
New-Item -ItemType Directory -Force $staging | Out-Null

Write-Host "  Copying files..." -ForegroundColor Gray
foreach ($item in $include) {
    $src = "$projectRoot\$item"
    $dst = "$staging\Satori-AI\$item"
    if (Test-Path $src) {
        if ((Get-Item $src) -is [System.IO.DirectoryInfo]) {
            # Exclude node_modules, venv, .git
            Copy-Item -Recurse -Force $src $dst
            # Remove heavy dev-only dirs from package
            Get-ChildItem -Recurse -Directory -Path $dst -Filter "node_modules" -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force
            Get-ChildItem -Recurse -Directory -Path $dst -Filter "venv" -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force
            Get-ChildItem -Recurse -Directory -Path $dst -Filter ".git" -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force
        } else {
            Copy-Item -Force $src $dst
        }
    } else {
        Write-Host "  WARNING: $item not found, skipping" -ForegroundColor Yellow
    }
}

# Create zip
Write-Host "  Creating $packageName..." -ForegroundColor Gray
if (Test-Path $packagePath) { Remove-Item -Force $packagePath }

try {
    Compress-Archive -Path "$staging\Satori-AI\*" -DestinationPath $packagePath -Force
} catch {
    # Fallback for older PowerShell: use .NET
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [System.IO.Compression.ZipFile]::CreateFromDirectory("$staging\Satori-AI", $packagePath)
}

Remove-Item -Recurse -Force $staging

$packageSize = [math]::Round((Get-Item $packagePath).Length / 1MB, 1)
Write-Host "  Package: $packagePath ($packageSize MB)" -ForegroundColor Green

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  Distribution package ready!" -ForegroundColor Green
Write-Host "  $packagePath" -ForegroundColor White
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "  User instructions:" -ForegroundColor Cyan
Write-Host "  1. Extract $packageName to any folder" -ForegroundColor White
Write-Host "  2. Copy .env.example to .env and configure your API keys" -ForegroundColor White
Write-Host "  3. Double-click Satori-Launcher.exe" -ForegroundColor White
Write-Host "  4. Browser opens automatically with setup guide" -ForegroundColor White
Write-Host ""
