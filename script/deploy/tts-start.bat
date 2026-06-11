@echo off
cd /d "%~dp0"
set "HERE=%~dp0..\services\tts"
:: ffmpeg-python wraps the ffmpeg CLI; it needs ffmpeg.exe on PATH
set "PATH=%HERE%;%PATH%"
echo Starting TTS (port 5030)...
"..\runtime\python-3.13\python.exe" -c "import sys; sys.path.insert(0, r'%HERE%\packages'); sys.path.insert(0, r'%HERE%'); exec(compile(open(r'%HERE%\app.py', encoding='utf-8').read(), r'%HERE%\app.py', 'exec'), {'__name__': '__main__', '__file__': r'%HERE%\app.py'})"
