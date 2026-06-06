@echo off
cd /d "%~dp0"
set "HERE=%~dp0..\live2d-widget"
echo Starting Live2D Widget...
"..\runtime\python-3.13\pythonw.exe" -c "import sys; sys.path.insert(0, r'%HERE%\packages'); sys.path.insert(0, r'%HERE%'); exec(compile(open(r'%HERE%\live2d-launcher.py', encoding='utf-8').read(), r'%HERE%\live2d-launcher.py', 'exec'), {'__name__': '__main__', '__file__': r'%HERE%\live2d-launcher.py'})"
