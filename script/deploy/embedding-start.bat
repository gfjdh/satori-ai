@echo off
cd /d "%~dp0"
set "HERE=%~dp0..\services\embedding"
echo Starting Embedding (port 7860)...
"..\runtime\python-3.13\python.exe" -c "import sys, os; sys.path.insert(0, r'%HERE%\packages'); sys.path.insert(0, r'%HERE%'); os.chdir(r'%HERE%'); from uvicorn import run; run('main:app', host='0.0.0.0', port=7860)"
