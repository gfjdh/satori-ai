@echo off
cd /d "%~dp0"
set "HERE=%~dp0..\webui"
echo Starting WebUI (port 5173)...
"..\runtime\node\node.exe" "%HERE%\serve.cjs"
