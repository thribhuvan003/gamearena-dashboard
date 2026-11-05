@echo off
cd /d "%~dp0"
rem Start Docker Desktop and the cockroachdb container first.
rem SQL reads the totals, logic combines them, Django serves them, and React shows them.
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
