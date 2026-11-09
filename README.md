# GameArena insights

Internal dashboard for GameArena session telemetry: how many sessions connect, why the rest
don't, how long video takes to start, and how smooth the stream is.

## Run it

Needs Python 3.13, Node 20+ and Docker Desktop with the `cockroachdb` container.

| Command | What it does |
|---|---|
| `setup.cmd` | First time only: Python packages, frontend packages, frontend build |
| `process.cmd` | Tags new sessions (`process.cmd --full` retags all of them) |
| `start.cmd` | Starts the database, tags new sessions, keeps tagging every 5 minutes in a separate window, opens http://127.0.0.1:8000 |
| `check.cmd` | Django check, unit tests and frontend build |
| `verify.cmd` | Checks every dashboard number against SQL written separately, on the real database |

Set `DATABASE_URL` to use a database other than the local one.

## How the data flows

```
session_telemetry_events / session_telemetry_stats      raw telemetry, only ever read
        |
processor/           batch job: reads new sessions 200 at a time, cleans them,
        |            tags them with logic/rules.py, saves the results
        v
session_analysis     one row per session: facts, tags, reason
session_day_analysis one row per session per UTC day: streamed time, FPS
        |
backend/             Django JSON API: plain queries on the two tables above
        |
frontend/            React page: cards, filters with counts, session lists and details
```

Nothing is worked out while a page loads. If the rules change, the next run retags every session.

## Folders

| Folder | Contents |
|---|---|
| `logic/` | Plain Python, no Django and no database. `rules.py` decides every tag, card and reason; `dates.py` checks dates and pages |
| `processor/` | The tagging job (`python -m processor`) |
| `database/` | All SQL, one file per part: `impact.sql` (main page), `sessions.sql` (session page), `processor.sql` (the job), `analysis_schema.sql` (the job's tables). Each file is split into named reports by `-- report: name` lines. `repository.py` is the only code that connects to the database |
| `database/one_time/` | SQL run by hand: checks on the imported data, and an index for the raw stats table |
| `backend/` | Django settings, URLs and views. Read-only connection |
| `frontend/` | React + Vite. `npm run build` writes `frontend/dist`, which Django serves |
| `tests/` | Unit tests for the rules, the job and the API, plus `verify_numbers.py` (run by `verify.cmd`) |

## Adding a card or filter

1. Add its title and one-line definition to `DEFINITIONS` in `logic/rules.py`, and its rule to `matches()`.
2. Run `process.cmd`. Every session gets the new tag, and it appears in the filter list.
3. Show it as a card in `frontend/src/impact.jsx` if needed.

## Rules worth knowing

- Times and days are UTC.
- Errors are tagged by type and by the stage the app reports (Session, Video, Input, …).
  Only known names become tags. Errors after a session has ended are left out.
- A connection error after a session has ended is a stale retry, not a failure.
- Connection rates divide by sessions that tried to connect.
- Streamed time counts each session-second once, from the player app's per-second stats.
  41% of connected sessions sent no stats, so streamed hours are a minimum.
- 30 FPS is the idle rate, so only readings below 30 count as low.
- "High skipped frames" (10+ in a second, for 10% of the session) is a proposed rule
  waiting for the team to confirm it.
