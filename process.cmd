@echo off
cd /d "%~dp0"
rem Tag new sessions for the dashboard. Only the analysis tables are written; raw telemetry is only read.
rem Add --full to retag every session.
if not exist .venv\Scripts\python.exe (
    echo Run setup.cmd first.
    exit /b 1
)
docker start cockroachdb >nul
if errorlevel 1 (
    echo Open Docker Desktop, then run process.cmd again.
    exit /b 1
)
.venv\Scripts\python -m processor %*
