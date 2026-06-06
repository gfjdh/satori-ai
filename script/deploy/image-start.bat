@echo off
cd /d "%~dp0"
set "HERE=%~dp0..\services\image"
echo Starting Image (port 8742)...
"..\runtime\python-3.13\python.exe" -c "import sys, os; sys.path.insert(0, r'%HERE%\packages'); sys.path.insert(0, r'%HERE%'); os.chdir(r'%HERE%'); from uvicorn import run; run('app:app', host='0.0.0.0', port=8742)"
