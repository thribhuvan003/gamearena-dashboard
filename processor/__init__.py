"""Batch job that tags every session once, so the dashboard only has to read the results.

    python -m processor              new data since the last run
    python -m processor --full       every session again
    python -m processor --every 300  keep running, checking for new data every 5 minutes

It reads the raw telemetry, works out each session's facts and tags with the rules in
logic/rules.py, and writes them to session_analysis and session_day_analysis.
The raw telemetry tables are only read.
"""
import argparse
import sys
import time
from datetime import datetime, timedelta, timezone
from hashlib import sha256
from pathlib import Path

import psycopg

from database import repository
from logic.rules import HIGH_SKIP, LOW_FPS, combine_sessions, tags

ROOT = Path(__file__).resolve().parents[1]
BATCH = 200
EPOCH = datetime(1970, 1, 1, tzinfo=timezone.utc)
# Events have no insert time, so each run looks a day back for late arrivals.
# Stats have created_at, so a few minutes of overlap is enough.
EVENTS_LOOKBACK = timedelta(days=1)
STATS_LOOKBACK = timedelta(minutes=10)
DAY_COLUMNS = ("events", "batches", "streamed_seconds", "low_fps_seconds", "high_skip_seconds",
               "fps_sum", "fps_valid")
# Facts a session may not have, such as a failure time when it never failed. Saved as empty.
OPTIONAL = ("first_seen", "last_failure", "last_success", "first_success", "first_ready_ms", "failure_detail")
RULE_FILES = ("logic/rules.py", "database/processor.sql", "database/analysis_schema.sql", "processor/__init__.py")


def rules_version():
    # Changing a rule, the job or its SQL changes this, and the next run retags every session.
    # Line endings are ignored, so a Windows and a Linux checkout agree.
    text = b"".join((ROOT / name).read_bytes().replace(b"\r\n", b"\n") for name in RULE_FILES)
    return sha256(text).hexdigest()[:16]


def create_tables(connection):
    text = (ROOT / "database" / "analysis_schema.sql").read_text(encoding="utf-8")
    for statement in text.split(";"):
        if any(line.strip() and not line.strip().startswith("--") for line in statement.splitlines()):
            connection.execute(statement)


def read(connection, name, params=None):
    return connection.execute(repository.QUERIES[name], params).fetchall()


def day_facts(connection, ids):
    # One row per session and UTC day, merged from the events, errors, batches and seconds reports.
    params = {"ids": ids, "low_fps": LOW_FPS, "high_skip": HIGH_SKIP}
    days = {}
    for name in ("process_events", "process_errors", "process_batches", "process_seconds"):
        for row in read(connection, name, params):
            days.setdefault((str(row["session_id"]), row["day"]), {}).update(row)
    return list(days.values())


def process_batch(connection, ids, version):
    days = day_facts(connection, ids)
    sessions = combine_sessions([days])
    measures = read(connection, "process_measures", {"ids": ids})
    error_reasons = read(connection, "process_error_reasons", {"ids": ids})
    queries = repository.QUERIES
    # Saving the batch and taking it off the queue happen together, so it is never done twice or lost.
    with connection.transaction(), connection.cursor() as cursor:
        cursor.execute(queries["process_dequeue"], {"ids": ids})
        cursor.execute(queries["process_clear_days"], {"ids": ids})
        cursor.execute(queries["process_clear_sessions"], {"ids": ids})
        cursor.execute(queries["process_clear_measures"], {"ids": ids})
        cursor.execute(queries["process_clear_error_reasons"], {"ids": ids})
        cursor.executemany(queries["process_save_day"], [
            {"day": day["day"], "session_id": day["session_id"],
             **{column: day.get(column, 0) for column in DAY_COLUMNS}} for day in days])
        cursor.executemany(queries["process_save_session"], [
            {**dict.fromkeys(OPTIONAL), **session, "tags": tags(session), "rules_version": version}
            for session in sessions])
        cursor.executemany(queries["process_save_measure"], measures)
        cursor.executemany(queries["process_save_error_reason"], error_reasons)
    return len(sessions)


def with_retries(work, attempts=5):
    # CockroachDB asks the client to retry a transaction that clashed with another one.
    for attempt in range(attempts):
        try:
            return work()
        except psycopg.errors.SerializationFailure:
            if attempt == attempts - 1:
                raise
            time.sleep(0.5 * (attempt + 1))


def fill_queue(connection, full, version):
    # Where the data ends now. It becomes the saved point only when the queue is empty,
    # so a run that stops early carries on from the same point next time.
    marks = read(connection, "process_marks")[0]
    done = next(iter(read(connection, "process_state", {"name": "sessions"})), None)
    if done and done["rules_version"] != version:
        full = True  # The rules changed, so every session is retagged.
    events_from = not full and done and done["events_until"] and done["events_until"] - EVENTS_LOOKBACK
    stats_from = not full and done and done["stats_until"] and done["stats_until"] - STATS_LOOKBACK
    connection.execute(repository.QUERIES["process_queue_changed"], {
        "events_since": events_from or EPOCH, "events_until": marks["events_until"] or EPOCH,
        "stats_since": stats_from or EPOCH, "stats_until": marks["stats_until"] or EPOCH})
    connection.execute(repository.QUERIES["process_save_state"], {"name": "pending", **marks,
                                                                   "rules_version": version})


def run(full, batch):
    version = rules_version()
    started = time.monotonic()
    tagged = 0
    with repository.connect(write=True) as connection:
        create_tables(connection)
        if not read(connection, "process_lock"):
            print("Another run is still tagging sessions. Try again when it has finished.", file=sys.stderr)
            return False
        try:
            pending = next(iter(read(connection, "process_state", {"name": "pending"})), None)
            if full:
                connection.execute(repository.QUERIES["process_queue_clear"])
            # An empty queue starts a new run; otherwise the last run stopped early and carries on.
            if full or not read(connection, "process_next", {"batch": 1}) or not pending:
                fill_queue(connection, full, version)
            while ids := [str(row["session_id"]) for row in read(connection, "process_next", {"batch": batch})]:
                tagged += with_retries(lambda: process_batch(connection, ids, version))
                # A long run keeps its lock fresh, so it is never mistaken for one that died.
                connection.execute(repository.QUERIES["process_lock_refresh"])
                print(f"Tagged {tagged} sessions")
            pending = read(connection, "process_state", {"name": "pending"})[0]
            connection.execute(repository.QUERIES["process_save_state"], {**pending, "name": "sessions"})
        finally:
            connection.execute(repository.QUERIES["process_unlock"])
    print(f"Done in {time.monotonic() - started:.0f} s. {tagged} sessions updated.")
    return True


def main(argv=None):
    parser = argparse.ArgumentParser(prog="python -m processor", description="Tag sessions for the dashboard.")
    parser.add_argument("--full", action="store_true", help="retag every session, not only new data")
    parser.add_argument("--batch", type=int, default=BATCH, help="sessions per batch (default %(default)s)")
    parser.add_argument("--every", type=int, metavar="SECONDS",
                        help="keep running, looking for new data every SECONDS")
    args = parser.parse_args(argv)
    if not args.every:
        sys.exit(0 if run(args.full, args.batch) else 1)
    # Keeps the dashboard current while it is open. A failed run is retried at the next interval.
    full = args.full
    while True:
        try:
            run(full, args.batch)
            full = False
        except psycopg.Error as error:
            print(f"Run failed ({type(error).__name__}); trying again in {args.every} s.", file=sys.stderr)
        time.sleep(args.every)
