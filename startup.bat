@echo off
setlocal
cd /d "%~dp0"

set "FRONTEND_PORT=3100"
set "BACKEND_PORT=5100"

echo.
echo ======== Sanjeevni-AI Local Startup ========
echo Frontend: http://localhost:%FRONTEND_PORT%
echo Backend:  http://localhost:%BACKEND_PORT%
echo.

where python >nul 2>&1 || (echo [ERROR] Python is not installed.& exit /b 1)
where npm >nul 2>&1 || (echo [ERROR] Node.js/npm is not installed.& exit /b 1)

if not exist "venv\Scripts\python.exe" (
    echo [INFO] Creating Python virtual environment...
    python -m venv venv || exit /b 1
)

echo [INFO] Installing backend dependencies...
venv\Scripts\python.exe -m pip install -q -r AI_Health_UI\requirements.txt || exit /b 1

if not exist "web-app\node_modules" (
    echo [INFO] Installing frontend dependencies...
    call npm --prefix web-app install || exit /b 1
)

echo [INFO] Starting backend on port %BACKEND_PORT%...
start "Sanjeevni-AI Backend :%BACKEND_PORT%" /D "%~dp0AI_Health_UI" cmd /k "set FLASK_PORT=%BACKEND_PORT%&& ..\venv\Scripts\python.exe app.py"

echo [INFO] Starting frontend on port %FRONTEND_PORT%...
start "Sanjeevni-AI Frontend :%FRONTEND_PORT%" /D "%~dp0web-app" cmd /k "npm run dev"

echo.
echo [OK] Both services started on separate ports.
echo Open http://localhost:%FRONTEND_PORT%
endlocal
