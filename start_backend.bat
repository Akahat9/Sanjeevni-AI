@echo off
setlocal
cd /d "%~dp0"
set "PORT=5100"

for /f "tokens=5" %%P in ('netstat -ano ^| findstr ":5100" ^| findstr "LISTENING"') do taskkill /PID %%P /F >nul 2>&1

echo Starting production-style API at http://127.0.0.1:5100
echo This starts the backend only. For the full UI, run startup.bat and open http://localhost:3100
venv\Scripts\python.exe AI_Health_UI\app.py
endlocal
