@echo off
cd /d "%~dp0.."
rem Check every dashboard number against SQL written separately, on the real database.
rem It reads real company data: keep its output private.
rem Add two dates (start end) to check a shorter range.
if not exist .venv\Scripts\python.exe (
    echo Run scripts\setup.cmd first.
    exit /b 1
)
.venv\Scripts\python checks\verify_numbers.py %*
