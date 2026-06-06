@echo off
cd /d "%~dp0"
set "HERE=%~dp0..\services\browser"
set "PLAYWRIGHT_BROWSERS_PATH=%~dp0..\playwright-browsers"
echo Starting Browser (port 8743)...
"..\runtime\python-3.13\python.exe" -c "import sys; sys.path.insert(0, r'%HERE%\packages'); exec(compile(open(r'%HERE%\server.py', encoding='utf-8').read(), r'%HERE%\server.py', 'exec'), {'__name__': '__main__', '__file__': r'%HERE%\server.py'})"
