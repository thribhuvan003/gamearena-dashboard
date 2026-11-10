"""Batch job that tags every session once, so the dashboard only has to read the results.

    python -m pipeline              new data since the last run
    python -m pipeline --full       every session again
    python -m pipeline --every 300  keep running, checking for new data every 5 minutes

It reads the raw telemetry, works out each session's facts and tags with the rules in
pipeline/rules.py, and writes them to session_analysis, session_day_analysis, session_day_measures
and session_day_error_events. It keeps its own progress in processor_state, processor_queue and
processor_lock. The raw telemetry tables are only read.
"""
import argparse
import sys
import time
from datetime import datetime, timedelta, timezone
from hashlib import sha256
from pathlib import Path

import psycopg

from shared import db
from pipeline.rules import HIGH_SKIP, LOW_FPS, combine_sessions, tags

ROOT = Path(__file__).resolve().parents[1]
# Sessions tagged per transaction; --batch changes it.
BATCH = 200
# Stands for "from the very start" when there is no saved point yet.
EPOCH = datetime(1970, 1, 1, tzinfo=timezone.utc)
# Events have no insert time, so each run looks a day back for late arrivals.
# Stats have created_at, so a few minutes of overlap is enough.
EVENTS_LOOKBACK = timedelta(days=1)
STATS_LOOKBACK = timedelta(minutes=10)
# The per-day numbers saved to session_day_analysis. A day without one of them saves 0.
DAY_COLUMNS = ("events", "batches", "streamed_seconds", "low_fps_seconds", "high_skip_seconds",
               "fps_sum", "fps_valid")
# Facts a session may not have, such as a failure time when it never failed. Saved as empty.
OPTIONAL = ("first_seen", "last_failure", "last_success", "first_success", "first_ready_ms", "failure_detail")
# The files that decide the tags (see rules_version). Editing any of them, even a comment, retags
# every session on the next run.
RULE_FILES = ("pipeline/rules.py", "pipeline/sql/job.sql", "pipeline/sql/schema.sql", "pipeline/job.py")


def rules_version():
    # Changing a rule, the job or its SQL changes this, and the next run retags every session.
    # Line endings are ignored, so a Windows and a Linux checkout agree.
    text = b"".join((ROOT / name).read_bytes().replace(b"\r\n", b"\n") for name in RULE_FILES)
    return sha256(text).hexdigest()[:16]


def create_tables(connection):
    # Runs schema.sql one statement at a time and skips pieces that hold only comments. The file is
    # split on semicolons, so a comment there must never contain one.
    text = (ROOT / "pipeline" / "sql" / "schema.sql").read_text(encoding="utf-8")
    for statement in text.split(";"):
        if any(line.strip() and not line.strip().startswith("--") for line in statement.splitlines()):
            connection.execute(statement)


def read(connection, name, params=None):
    # A named query on the job's own connection, which may write, unlike db.query.
    return connection.execute(db.QUERIES[name], params).fetchall()


def day_facts(connection, ids):
    # One row per session and UTC day, merged from the events, errors, batches and seconds reports.
    params = {"ids": ids, "low_fps": LOW_FPS, "high_skip": HIGH_SKIP}
    days = {}
    for name in ("process_events", "process_errors", "process_batches", "process_seconds"):
        for row in read(connection, name, params):
            days.setdefault((str(row["session_id"]), row["day"]), {}).update(row)
    return list(days.values())


def process_batch(connection, ids, version):
    # Tags one batch of sessions and replaces everything stored for them. All reading happens first,
    # so the transaction below only deletes and inserts.
    days = day_facts(connection, ids)
    sessions = combine_sessions([days])
    measures = read(connection, "process_measures", {"ids": ids})
    error_events = read(connection, "process_error_events", {"ids": ids})
    queries = db.QUERIES
    # Saving the batch and taking it off the queue happen together, so it is never done twice or lost.
    with connection.transaction(), connection.cursor() as cursor:
        for name in ("process_dequeue", "process_clear_days", "process_clear_sessions", "process_clear_measures",
                     "process_clear_error_events"):
            cursor.execute(queries[name], {"ids": ids})
        # Old rows are gone; save the new ones: per session and day, per session, measurements, errors.
        cursor.executemany(queries["process_save_day"], [
            {"day": day["day"], "session_id": day["session_id"],
             **{column: day.get(column, 0) for column in DAY_COLUMNS}} for day in days])
        cursor.executemany(queries["process_save_session"], [
            {**dict.fromkeys(OPTIONAL), **session, "tags": tags(session), "rules_version": version}
            for session in sessions])
        cursor.executemany(queries["process_save_measure"], measures)
        cursor.executemany(queries["process_save_error_event"], error_events)
    return len(sessions)


def with_retries(work, attempts=5):
    # CockroachDB asks the client to retry a transaction that clashed with another one.
    for attempt in range(attempts):
        try:
            return work()
        except psycopg.errors.SerializationFailure:
            # The last attempt lets the error through; earlier ones wait a little longer each time.
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
    # Each table resumes a little before its saved point (see the lookbacks above). With --full or no
    # saved point these are empty, and the queue is filled from EPOCH.
    events_from = not full and done and done["events_until"] and done["events_until"] - EVENTS_LOOKBACK
    stats_from = not full and done and done["stats_until"] and done["stats_until"] - STATS_LOOKBACK
    connection.execute(db.QUERIES["process_queue_changed"], {
        "events_since": events_from or EPOCH, "events_until": marks["events_until"] or EPOCH,
        "stats_since": stats_from or EPOCH, "stats_until": marks["stats_until"] or EPOCH})
    # Saved as "pending" until the queue is empty; run() then copies it to "sessions".
    connection.execute(db.QUERIES["process_save_state"], {"name": "pending", **marks, "rules_version": version})


def run(full, batch):
    version = rules_version()
    started = time.monotonic()
    tagged = 0
    with db.connect(write=True) as connection:
        # Creates the pipeline's own tables on first use; safe to repeat.
        create_tables(connection)
        # Another live run holds the lock: stop rather than tag the same sessions twice.
        if not read(connection, "process_lock"):
            print("Another run is still tagging sessions. Try again when it has finished.", file=sys.stderr)
            return False
        try:
            pending = next(iter(read(connection, "process_state", {"name": "pending"})), None)
            # --full starts over, dropping whatever a stopped run left in the queue.
            if full:
                connection.execute(db.QUERIES["process_queue_clear"])
            # An empty queue starts a new run; otherwise the last run stopped early and carries on.
            if full or not read(connection, "process_next", {"batch": 1}) or not pending:
                fill_queue(connection, full, version)
            # Take the next batch from the queue until it is empty.
            while ids := [str(row["session_id"]) for row in read(connection, "process_next", {"batch": batch})]:
                tagged += with_retries(lambda: process_batch(connection, ids, version))
                # A long run keeps its lock fresh, so it is never mistaken for one that died.
                connection.execute(db.QUERIES["process_lock_refresh"])
                print(f"Tagged {tagged} sessions")
            # The queue is empty, so the point this run read up to becomes the saved point.
            pending = read(connection, "process_state", {"name": "pending"})[0]
            connection.execute(db.QUERIES["process_save_state"], {**pending, "name": "sessions"})
        finally:
            # Released even when the run fails, so the next run need not wait an hour for it to expire.
            connection.execute(db.QUERIES["process_unlock"])
    print(f"Done in {time.monotonic() - started:.0f} s. {tagged} sessions updated.")
    return True


def main(argv=None):
    parser = argparse.ArgumentParser(prog="python -m pipeline", description="Tag sessions for the dashboard.")
    parser.add_argument("--full", action="store_true", help="retag every session, not only new data")
    parser.add_argument("--batch", type=int, default=BATCH, help="sessions per batch (default %(default)s)")
    parser.add_argument("--every", type=int, metavar="SECONDS",
                        help="keep running, looking for new data every SECONDS")
    args = parser.parse_args(argv)
    # A single run. Exit code 1 tells a script that another run was busy.
    if not args.every:
        sys.exit(0 if run(args.full, args.batch) else 1)
    # Keeps the dashboard current while it is open. A failed run is retried at the next interval.
    full = args.full
    while True:
        try:
            # Only a run that really happened clears --full; a run that found another one busy
            # tries the full retag again next time.
            if run(full, args.batch):
                full = False
        except psycopg.Error as error:
            print(f"Run failed ({type(error).__name__}); trying again in {args.every} s.", file=sys.stderr)
        time.sleep(args.every)
