@echo off
cd /d "%~dp0"
set "HERE=%~dp0..\services\asr"
echo Starting ASR (port 5032)...
"..\runtime\python-3.12\python.exe" -c "import sys; sys.path.insert(0, r'%HERE%\packages'); sys.path.insert(0, r'%HERE%'); exec(compile(open(r'%HERE%\app.py', encoding='utf-8').read(), r'%HERE%\app.py', 'exec'), {'__name__': '__main__', '__file__': r'%HERE%\app.py'})"
