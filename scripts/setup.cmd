@echo off
cd /d "%~dp0.."
rem First-time setup. After this, scripts\check.cmd verifies the app and scripts\start.cmd runs it.
rem Install the small Python and React dependencies once.
if not exist .venv\Scripts\python.exe python -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt
if errorlevel 1 exit /b 1
call npm --prefix ui ci --no-fund
if errorlevel 1 exit /b 1
call npm --prefix ui run build
if errorlevel 1 exit /b 1
