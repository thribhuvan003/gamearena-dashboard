@echo off
cd /d "%~dp0"
rem Check every dashboard number against SQL written separately, on the real database.
rem Add two dates (start end) to check a shorter range.
if not exist .venv\Scripts\python.exe (
    echo Run setup.cmd first.
    exit /b 1
)
.venv\Scripts\python tests\verify_numbers.py %*
