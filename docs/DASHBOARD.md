# Dashboard code walkthrough

The application reads summaries from local CockroachDB and shows them as large, readable cards and tables. There are no graphs. The page and CSV contain aggregates, not actual session IDs, connection IDs, diagnostic contents or credentials.

## Start and use it

Start Docker Desktop and the existing `cockroachdb` container. If needed, run `docker start cockroachdb` after Docker starts.

Open a Command Prompt terminal in the project folder. Run `setup.cmd` once on a fresh copy, then `start.cmd`. Open [the local dashboard](http://127.0.0.1:8000). Keep the terminal running; Ctrl+C stops Django. Starting rebuilds the frontend before launching the server.

- **All data:** use the first and last stored dates.
- **Latest 30 days:** use up to 30 calendar days ending on the last stored date, not today. Python calculates this boundary.
- **Choose custom dates:** open the native disclosure, choose From and To, then select Apply dates.
- **Refresh data:** rediscover dates and replace the selected reports' cache. All data and Latest 30 days follow newly imported dates; custom dates are preserved.

Both dates are included, in UTC. Panels load independently. **Download report CSV** is available after every report finishes. To add another compatible month, import it into the existing tables, then select Refresh data and All data. Dates and months are discovered rather than hard-coded.

## Follow one request

`React date selection -> Django report view -> read-only SQL -> Python calculations -> JSON -> React cards and tables`

Django **is the Python backend**; there is no second Python server. `logic` holds ordinary Python functions that Django calls, so date and arithmetic rules are easy to read and test. React is the separate JavaScript frontend, built into static files that Django serves at the same local address.

## File map

| File | Purpose |
| --- | --- |
| `setup.cmd` | Install dependencies and build the frontend for a fresh copy. |
| `start.cmd` | Rebuild saved frontend changes, then start Django on `127.0.0.1:8000`. |
| `backend/manage.py` | Entry point for Django server and check commands. |
| `backend/config.py` | Django settings, including the local cache under `.cache`. |
| `backend/urls.py` | Route page, named report and built-asset requests. |
| `backend/views.py` | Validate requests, select reports and return JSON or a useful error; also serve the built page. |
| `backend/repository.py` | Load fixed SQL files, access the database read-only and cache aggregates. |
| `backend/requirements.txt` | List Python dependencies. |
| `logic/summary.py` | Calculate date boundaries, percentages, Latest 30 days and outcome groups. |
| `logic/measurements.py` | Combine daily totals for selected dates and calendar months. |
| `frontend/src/main.jsx` | Fetch reports, manage controls/loading/errors, assemble sections and export CSV. |
| `frontend/src/sections.jsx` | Render shared cards/tables and the session, investigation, performance, monthly and data-guide sections. |
| `frontend/src/guide.js` | Keep field definitions and explanations together. |
| `frontend/src/style.css` | Set readable text, spacing, colors and responsive layout. |
| `tests/test_summary.py` | Check dates, percentages and outcomes. |
| `tests/test_measurements.py` | Check daily and monthly aggregation. |
| `tests/test_api.py` | Check request validation and report behavior. |
| `tests/test_cache.py` | Check cache reuse and replacement. |
| `.vscode/settings.json` | Keep generated/dependency folders out of the Explorer and set editing preferences. |

Edit `frontend/src`, not generated `frontend/dist`. `.venv`, `node_modules`, `dist`, `__pycache__` and `.cache` are hidden in VS Code but remain on disk. Small `__init__.py` files mark Python packages.

## Main code blocks

**`backend/views.py`:** `report()` accepts known report names. The range report returns stored bounds and Python's `recent_start`. Other reports first validate dates with `date_window()`, then read the queries for that section. Error handlers return short messages without database details. `index()` serves the built page.

**`backend/repository.py`:** `QUERIES` loads approved SQL files at startup. `query()` binds date parameters and uses a read-only transaction. `read()` checks the cache before querying. `performance_report()` obtains daily measurement totals, then asks Python to combine selected days. A lock stops simultaneous requests from duplicating sample calculations in this server.

**`logic/summary.py`:** `date_window()` uses midnight after the end date as an exclusive boundary, so the whole end date is included. `percent()` returns no percentage for an empty denominator. `recent_start()` counts back 29 days from the last stored date, stopping at the first date. `explain_outcomes()` subtracts overlapping success/failure flags into four groups that add up.

**`logic/measurements.py`:** `selected_days()` filters daily rows. `combine_measurements()` adds counts and sums before dividing, and combines minima/maxima. `combine_inventory()` adds field-presence counts. `monthly_measurements()` groups those rows by calendar month and reuses the same calculation.

**`frontend/src/main.jsx`:** `getReport()` fetches named endpoints. One effect discovers dates; another loads four sections and cancels outdated requests after a date change. Date handlers apply presets/custom dates and refresh reports. `exportReport()` builds quoted CSV cells from loaded aggregates. The final JSX block arranges controls and sections.

**`frontend/src/sections.jsx`:** shared formatters, notices, cards and tables keep presentation consistent. Section components receive calculated reports and explain them. `guide.js` supplies definitions; `style.css` controls appearance.

## SQL report map

These files are in `database/dashboard`. Reports use the same validated date window; `range.sql` discovers available bounds.

| SQL file | Question answered |
| --- | --- |
| `range.sql` | What are the first and last stored event/statistics dates? |
| `overview.sql` | How many distinct event sessions recorded each connection/outcome signal? |
| `trend.sql` | How many sessions, successes and failures were observed each day? |
| `failures.sql` | At which phases/stages were pipeline failure events recorded? |
| `coverage.sql` | How many statistics batches/sessions and headline measurement arrays exist? |
| `investigation.sql` | Which sessions have errors, reconnects, lifecycle gaps or multiple connections, and which exactly match statistics by session ID? |
| `payload.sql` | How often are useful optional payload fields present, and in how many sessions? |
| `readiness.sql` | What are the count, average, median and 95th percentile of valid readiness values? |
| `inventory.sql` | Which measurement fields occur each day, and which contain arrays? |
| `metrics.sql` | What are daily numeric sample counts, sums, minima, maxima and exclusions? |

`metrics.sql` expands measurement arrays except `ts`, checks entries, then groups by day/field. Individual samples stay in the database. `investigation.sql` groups events by session, selects distinct measured sessions, then joins by the actual session ID. Subtracting unrelated event/statistics session totals would not give this exact match.

## Cache and measurement rules

Normal reports are cached locally for five minutes. Daily measurement and field totals are cached for one hour. Date changes reuse daily totals instead of expanding all raw samples again. Refresh bypasses and replaces relevant entries. Cache files are generated locally under hidden `.cache`.

An average is `sum of valid samples / number of valid samples`, not an average of daily/batch averages. One sample of 10 and nine samples of 20 therefore give 19, not 15. Null entries are counted as missing; negative, non-numeric and non-finite entries are excluded as invalid. Remaining values are not automatically proven plausible.

The field guide covers nine discovered measurements: `fps`, `latency`, `jitter`, `bitrate`, `accumulatedFrames`, `decodeDuration`, `encodeDuration`, `downloadSpeed` and `skippedFrames`. Discovery remains dynamic: additional imported fields appear. Non-array/non-numeric fields receive coverage information without invented averages. Monthly comparisons reuse sample-weighted daily totals; the first and last selected months can be partial.

## Interpret results carefully

- Sessions are not unique people or returning users. There is no approved account-to-session mapping.
- Success and failure can occur in one session. Four non-overlapping groups separate these flags without assuming event order or permanent failure.
- Errors, reconnects, disconnects, missing end events and failure stages are evidence to investigate. Counts alone do not establish a cause or crash count. Several connection IDs do not automatically mean retries.
- A session is counted once per selected period but may appear on several days. Daily distinct-session totals need not add up to the period total.
- Events use `recorded_at`; statistics use `bucket_start`. An included batch can cross a date boundary: its samples are not individually timestamp-filtered.
- Performance represents measured sessions. Exact event/statistics matches use records inside the selected period. Missing statistics do not prove failure.
- FPS means frames per second. Other units and counter meanings need producer confirmation before assigning thresholds or interpreting totals. Bitrate/download speed are not total consumption.
- `timeToReadyMs` denotes milliseconds in its name, but its timer's start/end are unconfirmed. Median and p95 describe reported values, not a proven complete user wait.
- Payload presence counts show that fields exist, not that their values are valid or events failed. Raw diagnostic text and payload values are not displayed.

## Edit and verify

| Change | Next step |
| --- | --- |
| Python in `backend` or `logic` | Save; Django auto-reloads. Refresh data to replace cached calculations. |
| SQL in `database/dashboard` | Restart Django to reload query text, then select Refresh data. |
| React, guide text or CSS | Run `npm --prefix frontend run build`, then reload the browser. Restarting with `start.cmd` also builds. |
| Imported data | Select Refresh data; choose All data to include every stored date. |

Run from the project folder:

```cmd
.venv\Scripts\python -m unittest discover -s tests -v
.venv\Scripts\python backend\manage.py check
npm --prefix frontend run build
```

The backend defaults to the existing local development database. For another compatible database, set `DATABASE_URL` in CMD before starting. Keep that value out of source files and screenshots. The frontend has no database connection settings. Django accepts read requests for fixed reports; the app is configured for local use at `127.0.0.1`.
## Reading the tables

The main page starts with four product questions for the selected dates. `frontend/src/findings.jsx` presents the highest-count failure location, repeat reconnects, median and 95th-percentile readiness timing, and the two latest available monthly frame-rate averages. It reuses the same report results as the tables. Missing or single-month data receives its own explanation. Raw array coverage is a collection check and is available in the CSV, not a founder-facing table.

Every table has a **What these columns mean** control beside it. Open it for a plain-language definition of every column. The daily table also explains its main columns directly above the numbers.

- **Observed sessions:** distinct session IDs with at least one event inside the stated day or selected period. These are not necessarily newly started sessions or distinct people.
- **With success:** sessions with at least one `pipeline.connect.success` event in that day.
- **With failure:** sessions with at least one `pipeline.connect.failure` event in that day. A session can also have success.
- **Failure events:** every recorded `pipeline.connect.failure`, including repeated events from one session. This is not a unique failed connection count.
- **Sessions in the failure table:** distinct session IDs per phase/stage row. A session can appear in several rows.

For example, one session with three failure events and one success event contributes three failure events, one session with failure, and one session with success. This example explains the rule; it is not an assertion about an individual record.
