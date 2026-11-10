@echo off
cd /d "%~dp0.."
rem Check the application without importing or changing telemetry records.
if not exist .venv\Scripts\python.exe (
    echo Run scripts\setup.cmd first.
    exit /b 1
)
echo Checking Django settings...
.venv\Scripts\python manage.py check
if errorlevel 1 exit /b 1
echo Running calculation and API tests...
.venv\Scripts\python -m unittest discover -s tests -v
if errorlevel 1 exit /b 1
echo Building the page...
call npm --prefix ui run build
if errorlevel 1 exit /b 1
echo All checks passed. The dashboard can be started with scripts\start.cmd.
