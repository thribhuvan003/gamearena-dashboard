@echo off
cd /d "%~dp0.."
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
rem The pipeline tags sessions, Django serves the stored results, and React shows them.
rem Keep one local server for both the dashboard page and its summaries.
rem The first run sets everything up, which includes building the page.
if not exist .venv\Scripts\python.exe (
    call "%~dp0setup.cmd"
    if errorlevel 1 exit /b 1
) else (
    rem Rebuild the page so saved page edits are shown instead of an old build.
    call npm --prefix ui run build
    if errorlevel 1 exit /b 1
)
rem Tag anything new first, so the dashboard opens on current numbers.
rem If that fails or another run is busy, the page still opens and says how fresh its numbers are.
.venv\Scripts\python -m pipeline
rem Keep tagging new data every 5 minutes in its own window while the dashboard is open.
start "GameArena processor" /min .venv\Scripts\python -m pipeline --every 300
echo Open http://127.0.0.1:8000 in your browser.
.venv\Scripts\python manage.py runserver 127.0.0.1:8000
