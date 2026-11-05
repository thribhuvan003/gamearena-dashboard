@echo off
cd /d "%~dp0"
rem Keep one local server for both the dashboard page and its summaries.
if not exist .venv\Scripts\python.exe (
    echo Run setup.cmd first.
    exit /b 1
)
rem Rebuild the page so saved frontend edits are shown instead of an old build.
call npm --prefix frontend run build
if errorlevel 1 exit /b 1
echo Open http://127.0.0.1:8000 in your browser.
.venv\Scripts\python backend\manage.py runserver 127.0.0.1:8000
