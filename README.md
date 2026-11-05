# GameArena analytics dashboard

A local dashboard for session outcomes, connection evidence and performance measurements. The first section shows where setup failed, whether reconnects repeat, how long readiness takes and how measured frame rate changed. Supporting diagnostics stay available on demand. Only aggregate reports are displayed or exported.

Django is the Python backend. It runs the read-only SQL in `database/dashboard`, calls the small calculation functions in `logic`, and serves the separate React frontend.

## Run

1. Start Docker Desktop and the existing `cockroachdb` container.
2. Open a Command Prompt terminal in this folder. On a fresh copy, run `setup.cmd` once.
3. Run `start.cmd`, then open [the dashboard](http://127.0.0.1:8000). Keep the terminal open; Ctrl+C stops it. Starting also rebuilds the frontend.

Choose **All data**, **Latest 30 days**, or open **Choose custom dates**. Latest 30 days ends on the last stored date. Use **Refresh data** after importing data. **Download report CSV** becomes available after all reports load.

See [the dashboard walkthrough](docs/DASHBOARD.md) for each file's purpose, calculation rules and the edit workflow.

## Read the project in this order

1. `database/README.md`: the question answered by each SQL file.
2. `logic/summary.py` and `logic/measurements.py`: date and calculation rules.
3. `backend/views.py` and `backend/repository.py`: how an API request gets its results.
4. `frontend/src/main.jsx`: how the page requests reports and applies dates.
5. `frontend/src/findings.jsx`: the four product questions and their evidence. `sections.jsx`, `guide.js` and `style.css` supply the detailed tables, definitions and layout.

Run `check.cmd` from the VS Code CMD terminal to check Django, run the tests and build the frontend. It stops at the first failed step and does not import or change telemetry. Generated dependency and cache folders are hidden in Explorer to keep the source easy to find.

Session counts are not unique-user counts. Errors and failure stages are investigation clues, not proven causes. Measurement units and counter definitions still need producer confirmation, except for FPS.
