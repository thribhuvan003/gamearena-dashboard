@echo off
cd /d "%~dp0"
rem Install the small Python and React dependencies once.
if not exist .venv\Scripts\python.exe python -m venv .venv
.venv\Scripts\python -m pip install -r backend\requirements.txt
if errorlevel 1 exit /b 1
call npm --prefix frontend ci --no-fund
if errorlevel 1 exit /b 1
call npm --prefix frontend run build
