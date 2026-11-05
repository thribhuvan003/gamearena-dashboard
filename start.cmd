@echo off
cd /d "%~dp0"
rem Start the existing local database. Docker Desktop supplies the engine.
docker start cockroachdb >nul
if errorlevel 1 (
    echo Open Docker Desktop, then click Start dashboard again.
    exit /b 1
)
rem A second click opens the existing dashboard instead of starting another server.
curl.exe --silent --fail --max-time 3 http://127.0.0.1:8000/ | findstr /i "Gamearena" >nul
if not errorlevel 1 (
    echo Dashboard is already running at http://127.0.0.1:8000/
    start "" "http://127.0.0.1:8000/"
    exit /b 0
)
rem SQL reads the totals, logic combines them, Django serves them, and React shows them.
rem Keep one local server for both the dashboard page and its summaries.
if not exist .venv\Scripts\python.exe (
    call setup.cmd
    if errorlevel 1 exit /b 1
)
rem Rebuild the page so saved frontend edits are shown instead of an old build.
call npm --prefix frontend run build
if errorlevel 1 exit /b 1
echo Open http://127.0.0.1:8000 in your browser.
.venv\Scripts\python backend\manage.py runserver 127.0.0.1:8000
