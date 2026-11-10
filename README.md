# GameArena insights

Internal dashboard for GameArena session telemetry: how many sessions connect, why the rest
don't, how long video takes to start, and how smooth the stream is.

## Three parts

| Part | Folder | What it does |
|---|---|---|
| UI | `ui/` | The React page founders use. It only talks to the API |
| API | `api/` | Django JSON API. Reads the pipeline's stored results (and, for the session pop-up, that one session's raw events). Read-only |
| Pipeline | `pipeline/` | The batch job. Reads new raw telemetry, applies the rules once, stores the results |
| Shared | `shared/` | The one database connection (`db.py`) and date helpers, used by the API and the pipeline |

## Code tour

The files worth reading, in order:

1. `pipeline/rules.py`: every rule. What each tag, card and outcome means, and how a session gets it.
2. `pipeline/job.py`: the job that reads new telemetry, applies the rules once and stores the results.
3. `pipeline/sql/job.sql`: the facts the job reads from raw telemetry, and how it saves them.
4. `pipeline/sql/schema.sql`: the tables the job writes.
5. `api/sql/impact.sql`: every number on the main page, read from those tables.
6. `api/impact.py`: the main page's API: filters, comparison window, one batch of queries.
7. `ui/src/impact.jsx`: the main page. `affected.jsx` is a card's session list, `sessions.jsx` the session pop-up.
8. `checks/verify_numbers.py`: recounts every number from raw telemetry with separate SQL.

Everything else is plumbing: settings, the scripts below, tests and styles.

## Run it

Needs Python 3.13, Node 20+ and Docker Desktop with the `cockroachdb` container.

| Command | What it does |
|---|---|
| `scripts\setup.cmd` | First time only: Python packages, UI packages, UI build |
| `scripts\process.cmd` | Runs the pipeline on new sessions (`scripts\process.cmd --full` retags all of them) |
| `scripts\start.cmd` | Starts the database, rebuilds the page, runs the pipeline, keeps it running every 5 minutes in a separate window, and serves the dashboard at http://127.0.0.1:8000 (open it in your browser) |
| `scripts\check.cmd` | Django check, unit tests and UI build |
| `scripts\verify.cmd` | Checks every dashboard number against SQL written separately. It reads the real database, so keep its output private |

Set `DATABASE_URL` to use a database other than the local one.

Run the unit tests on their own with `.venv\Scripts\python -m unittest discover -s tests`, or one
file with `.venv\Scripts\python -m unittest discover -s tests -p test_impact.py`. They use made-up
data only and never touch the database. The UI's own tests run with `npm --prefix ui test`.

## How the data flows

```
session_telemetry_events / session_telemetry_stats   raw telemetry, only ever read
        |
pipeline/         batch job: reads changed sessions 200 at a time, works out their facts,
        |         tags them with pipeline/rules.py and saves the results to:
        v
session_analysis           one row per session: facts, tags and the reason line
session_day_analysis       one row per session and UTC day: events, streamed time, frame rate
session_day_measures       sum and count of every per-second reading, per session, day and measurement
session_day_error_events   every error event as sent, per session and day, with how often it came
processor_state            how far the last run read, and the rules it used
processor_queue            sessions still to tag in the current run
processor_lock             makes sure only one run tags at a time
        |
api/              Django JSON API, read-only
        |
ui/               React page: cards, charts, filters with counts, session lists and the session pop-up
```

The main page only reads the stored results above; nothing is worked out while it loads. The
session pop-up is the one exception: it reads that one session's raw events and readings, so it
shows exactly what the app sent. If the rules change, the next pipeline run retags every session.

## Folders

| Folder | Contents |
|---|---|
| `ui/` | React + Vite. `npm run build` writes `ui/dist`, which Django serves. `src/impact.jsx` is the main page, `affected.jsx` a card's session list, `sessions.jsx` the session pop-up, `charts.jsx` every chart (outcome bar, ranked bars, trend lines) and their colours, `noise.js` the rule for which changes are flagged, `share.jsx` copying links and IDs, `url.js` keeping the page's choices in the address bar |
| `api/` | Django settings, URLs and views (`impact.py` main page, `sessions.py` session pop-up, `views.py` dates and the page itself). `sql/` holds the queries the API runs. Read-only connection |
| `pipeline/` | `rules.py` decides every tag, card and reason; `job.py` is the batch job (`python -m pipeline`). `sql/job.sql` is what it reads and writes, `sql/schema.sql` its tables |
| `shared/` | `db.py` is the only code that connects to the database; it loads every `-- report: name` query from `api/sql/` and `pipeline/sql/`. `dates.py` checks dates and pages |
| `tests/` | Unit tests for the rules, the pipeline and the API. `helpers.py` holds what they share |
| `checks/` | Run by hand against the real database: `verify_numbers.py` (run by `scripts\verify.cmd`) recounts the dashboard's numbers from raw telemetry with its own SQL and prints counts and yes/no results only; `data_checks.sql` checks a new import |
| `scripts/` | The Windows scripts listed under "Run it" |

`api/sql/one_time_indexes.sql` is run once per database when deploying.

## Adding a card or filter

1. Add its title and one-line definition to `DEFINITIONS` in `pipeline/rules.py`, and its rule to `groups()`.
2. Put it in one section of `SECTIONS` to make it a filter, or in `NOT_FILTERS` to keep it a card and list only.
3. If its share should be out of fewer sessions than all of them, add it to `OF_ATTEMPTED`, `OF_CONNECTED` or `OF_MEASURED`.
4. If it needs a fact the pipeline does not collect yet: count it in `pipeline/sql/job.sql`, add a column to
   `pipeline/sql/schema.sql` (and to `process_save_session`) and, if it is added up across days, to `COUNTS`.
5. Run `scripts\process.cmd`. Every session gets the new tag, and it appears in the filter list.
6. Show it as a card in `ui/src/impact.jsx` if needed.

`tests/test_impact.py` fails when a card is missing from `groups()`, `SECTIONS`/`NOT_FILTERS` or sits in two share bases.

## Rules worth knowing

- Times and days are UTC.
- Every session with events has exactly one outcome: connected with no errors, connected after an
  error, connected but a later try failed, never connected with an error sent, never connected
  with no error sent, or never tried to connect. The outcome cards add up to all sessions.
- A connection error or a successful connect proves the session tried to connect, even when its
  attempt event was lost.
- A connection error after a session has ended is a stale retry, not a failure.
- An error is an event with level `error`. Errors are tagged by the app's event name and by the
  stage the app reports (Session, Video, Input, …). Only known names become tags. A connection
  state event (`webrtc.connection.state`, `ice.connection.state`) is an error type only when its
  state is `failed`. Errors after a session has ended are left out of the tags, and shown
  separately in the error list.
- Connection rates divide by sessions that tried to connect; time to video and lost video by
  sessions that connected; frame-rate groups by sessions that sent readings.
- Time to video is the value sent with the session's first successful connect.
- Streamed time counts each session-second once, from the player app's per-second readings.
  Sessions that connected but sent no readings are counted under "Connected, but sent no readings",
  so streamed hours are a minimum.
- 30 FPS is the idle rate, so only readings below 30 count as low.
- "Many skipped frames" (10+ in a second, for 10% of the session) is a proposed rule
  waiting for the team to confirm it.
- Comparisons: up to 6 days are compared with the same days a week earlier; 7 days or more
  with the same number of days just before.
- A change is only flagged when it is bigger than everyday noise (`ui/src/noise.js`): shares
  need a 99% two-proportion test and at least 100 sessions on each side, counts must move by more
  than their normal spread (about the square root of the count), daily numbers are judged
  against their own day-to-day spread over the last four weeks, and network numbers need a change
  of more than 10%.
- The trend lines show at least the last 28 days, ending on the last selected day.
