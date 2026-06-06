@echo off
cd /d "%~dp0.."
echo Starting Backend (port 3682)...
"runtime\node\node.exe" "dist\index.js"
