"""Check the dashboard against SQL written separately from the app, on the real database.

    python tests/verify_numbers.py                     all data
    python tests/verify_numbers.py 2026-10-01 2026-10-07

The unit tests use fake data; this checks the real numbers. Every query below reads the raw
telemetry directly and shares no code with the app. Over all data, every number must match.
For a shorter range a few sessions that cross the range's edges can differ, because tags
describe the whole session while these queries only see the chosen days.
"""
import math
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "backend.config")

import django  # noqa: E402

django.setup()

from django.test import Client  # noqa: E402

from database import repository  # noqa: E402
from logic.rules import ERROR_TYPES, STAGES  # noqa: E402

DAYS = "recorded_at >= %(start)s AND recorded_at < %(end)s::DATE + 1"
NOT_STALE = """NOT EXISTS (SELECT 1 FROM session_telemetry_events x WHERE x.session_id = e.session_id
    AND x.event_type = 'session_ended' AND x.recorded_at <= e.recorded_at)"""

SESSION_COUNTS = {
    "Sessions": f"SELECT COUNT(DISTINCT session_id) FROM session_telemetry_events WHERE {DAYS}",
    "Tried to connect": f"""SELECT COUNT(DISTINCT session_id) FROM session_telemetry_events
        WHERE payload->>'event' = 'pipeline.connect.attempt' AND {DAYS}""",
    "Connection failures": f"""SELECT COUNT(DISTINCT session_id) FROM session_telemetry_events e
        WHERE payload->>'event' = 'pipeline.connect.failure' AND {DAYS} AND {NOT_STALE}""",
    "Multiple attempts": f"""SELECT COUNT(*) FROM (SELECT session_id FROM session_telemetry_events
        WHERE payload->>'event' = 'pipeline.connect.attempt' AND {DAYS}
        GROUP BY session_id HAVING COUNT(*) > 1) x""",
    "Never connected": f"""SELECT COUNT(*) FROM (SELECT session_id FROM session_telemetry_events WHERE {DAYS}
        GROUP BY session_id
        HAVING COUNT(*) FILTER (WHERE payload->>'event' = 'pipeline.connect.attempt') > 0
            AND COUNT(*) FILTER (WHERE payload->>'event' = 'pipeline.connect.success') = 0) x""",
    "Stream drops": f"""SELECT COUNT(DISTINCT session_id) FROM session_telemetry_events
        WHERE payload->>'event' = 'webrtc.connection.state' AND payload->>'prev' = 'connected'
            AND payload->>'state' IN ('disconnected', 'failed') AND {DAYS}""",
}

STREAM = """
WITH readings AS (
    SELECT s.session_id, (s.samples->'ts'->>i)::INT8 // 1000 AS second,
        CASE WHEN jsonb_typeof(s.samples->'fps'->i) = 'number' THEN (s.samples->'fps'->>i)::FLOAT8 END AS fps,
        CASE WHEN jsonb_typeof(s.samples->'skippedFrames'->i) = 'number'
            THEN (s.samples->'skippedFrames'->>i)::FLOAT8 END AS skipped
    FROM session_telemetry_stats s, generate_series(0, jsonb_array_length(s.samples->'ts') - 1) AS i
    WHERE s.bucket_start >= %(start)s::TIMESTAMPTZ - INTERVAL '1 hour' AND s.bucket_start < %(end)s::DATE + 1
), kept AS (
    SELECT * FROM readings
    WHERE second >= EXTRACT(EPOCH FROM %(start)s::TIMESTAMPTZ)
        AND second < EXTRACT(EPOCH FROM (%(end)s::DATE + 1)::TIMESTAMPTZ)
        AND session_id IN (SELECT session_id FROM session_telemetry_events WHERE {days})
), seconds AS (
    SELECT session_id, second, COALESCE(BOOL_OR(fps >= 0 AND fps < 30), FALSE) AS low,
        COALESCE(BOOL_OR(skipped >= 10), FALSE) AS stutter
    FROM kept GROUP BY session_id, second
), averages AS (
    SELECT session_id, AVG(fps) FILTER (WHERE fps >= 0) AS fps FROM kept GROUP BY session_id
)
SELECT (SELECT COUNT(*) FROM seconds) AS streamed,
    (SELECT COUNT(*) FILTER (WHERE low) FROM seconds) AS low,
    (SELECT COUNT(*) FROM averages WHERE fps < 30) AS low_average,
    (SELECT COUNT(DISTINCT session_id) FROM seconds WHERE low) AS any_low,
    (SELECT COUNT(*) FROM (SELECT session_id FROM seconds GROUP BY session_id
        HAVING COUNT(*) FILTER (WHERE stutter) >= 0.1 * COUNT(*)) x) AS high_skip
""".format(days=DAYS)

WAITS = f"""SELECT (array_agg((payload->>'timeToReadyMs')::FLOAT8 ORDER BY recorded_at))[1] / 1000
    FROM session_telemetry_events
    WHERE payload->>'event' = 'pipeline.connect.success' AND jsonb_typeof(payload->'timeToReadyMs') = 'number'
        AND {DAYS}
    GROUP BY session_id"""

ERRORS = f"""SELECT COUNT(DISTINCT session_id) FROM session_telemetry_events e
    WHERE level = 'error' AND {DAYS} AND {NOT_STALE} AND payload->>%(field)s = %(value)s"""


ENDS = f"""SELECT COUNT(DISTINCT session_id) FROM session_telemetry_events
    WHERE event_type = 'session_ended' AND payload->>'end_reason' = %(value)s AND {DAYS}"""
END_TAGS = {"ended_device_deleted": "Device deleted", "ended_not_in_use": "Not in use", "ended_by_user": "Ended by user"}


def nearest_rank(values, share):
    values = sorted(values)
    return values[max(math.ceil(share * len(values)) - 1, 0)] if values else None


def main():
    with repository.connect() as connection:
        dates = connection.execute(repository.QUERIES["range"]).fetchone()
        start, end = (sys.argv[1], sys.argv[2]) if len(sys.argv) == 3 else (str(dates["start"]), str(dates["end"]))
        params = {"start": f"{start} 00:00:00+00", "end": end}

        def one(sql, **extra):
            return next(iter(connection.execute(sql, {**params, **extra}).fetchone().values()))

        found = {name: one(sql) for name, sql in SESSION_COUNTS.items()}
        stream = connection.execute(STREAM, params).fetchone()
        waits = [next(iter(row.values())) for row in connection.execute(WAITS, params).fetchall()]
        errors = {key: one(ERRORS, field="event", value=name) for name, (key, _, _) in ERROR_TYPES.items()}
        errors |= {"stage_" + stage.lower(): one(ERRORS, field="stage", value=stage) for stage in STAGES}
        errors |= {key: one(ENDS, value=reason) for key, reason in END_TAGS.items()}

    client = Client()
    data = client.get("/api/impact/", {"start": start, "end": end}).json()
    summary, groups = data["summary"], data["summary"]["groups"]
    rows = [
        ("Sessions", found["Sessions"], summary["sessions"]),
        ("Tried to connect", found["Tried to connect"], summary["attempted"]),
        ("Connection failures", found["Connection failures"], groups["failure"]["count"]),
        ("Multiple attempts", found["Multiple attempts"], groups["repeated_attempts"]["count"]),
        ("Never connected", found["Never connected"], groups["no_success"]["count"]),
        ("Stream drops", found["Stream drops"], groups["stream_drops"]["count"]),
        ("Streamed hours", round(stream["streamed"] / 3600, 2), round(summary["streamed_hours"], 2)),
        ("Hours below 30 FPS", round(stream["low"] / 3600, 2), round(summary["low_fps_hours"], 2)),
        ("Averaging below 30 FPS", stream["low_average"], groups["low_fps"]["count"]),
        ("Dropped below 30 FPS", stream["any_low"], groups["any_low_fps"]["count"]),
        ("High skipped frames", stream["high_skip"], groups["high_skip"]["count"]),
        ("Typical wait (s)", nearest_rank(waits, 0.5), summary["ready_p50"]),
        ("1 in 10 waited over (s)", nearest_rank(waits, 0.9), summary["ready_p90"]),
    ] + [(groups[key]["title"], count, groups[key]["count"]) for key, count in errors.items()]

    print(f"{start} to {end}")
    failed = 0
    for name, expected, shown in rows:
        failed += expected != shown
        print(f"  {'ok  ' if expected == shown else 'DIFF'}  {name:38} raw data {expected}  dashboard {shown}")
    # Every card's count must equal the length of its list.
    for key, group in groups.items():
        listed = client.get("/api/impact/", {"start": start, "end": end, "category": key}).json()["sessions"]["total"]
        if listed != group["count"]:
            failed += 1
            print(f"  DIFF  {group['title']}: card {group['count']}, list {listed}")
    print(f"{len(rows)} numbers and {len(groups)} lists checked: "
          + ("all match." if not failed else f"{failed} differ."))
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
