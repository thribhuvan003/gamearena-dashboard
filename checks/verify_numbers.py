"""Check the dashboard against SQL written separately from the app, on the real database.

    python checks/verify_numbers.py                     all data
    python checks/verify_numbers.py 2026-10-01 2026-10-07

The unit tests use fake data; this checks the real numbers. Every query below reads the raw
telemetry directly and shares no code with the app: event names, stages and limits are written
out again here on purpose, so a mistake in the app's rules cannot hide in both. Over all data,
every number must match. For a shorter range a few sessions that cross the range's edges can
differ, because tags describe the whole session while these queries only see the chosen days.

It prints counts and yes/no results only, never any text from the telemetry.
"""
import math
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "api.config")

import django  # noqa: E402

django.setup()

from django.test import Client  # noqa: E402

from shared import db  # noqa: E402

# The error tags and stages the dashboard knows, by the app's own names.
ERROR_EVENTS = {"error_dropped": "pipeline.connection.dropped", "error_video_connection": "webrtc.connection.state",
                "error_network_route": "ice.connection.state", "error_route_attempt": "ice.candidate.error",
                "error_channel_gave_up": "ws.reconnect.exhausted", "error_decode": "media.decode.error"}
STAGES = ("Session", "JoinSession", "Config", "Device", "Websocket", "WebRTC", "Video", "Scream", "Input", "Cursor")
# The end tags by the exact end reason the app sends.
END_TAGS = {"ended_device_deleted": "Device deleted", "ended_not_in_use": "Not in use", "ended_by_user": "Ended by user"}
# The outcome tags; on the dashboard they must add up to all sessions.
OUTCOMES = ("outcome_connected", "outcome_recovered", "outcome_later_failed", "outcome_failed", "outcome_silent",
            "outcome_not_tried")

# First and last event dates: the range checked when none is given.
DATES = "SELECT MIN(recorded_at)::DATE AS start, MAX(recorded_at)::DATE AS end FROM session_telemetry_events"
# The chosen days in UTC: start is a midnight timestamp, and the end date is included whole.
DAYS = "recorded_at >= %(start)s AND recorded_at < %(end)s::DATE + 1"
# An event on or after the session's first end is a retry of a closed session, not a real error.
NOT_STALE = """NOT EXISTS (SELECT 1 FROM session_telemetry_events x WHERE x.session_id = e.session_id
    AND x.event_type = 'session_ended' AND x.recorded_at <= e.recorded_at)"""
# A connection error proves an attempt, even when the attempt event itself was lost.
TRIED = f"""SELECT DISTINCT session_id FROM session_telemetry_events e WHERE {DAYS}
    AND (payload->>'event' = 'pipeline.connect.attempt'
        OR (payload->>'event' = 'pipeline.connect.failure' AND {NOT_STALE}))"""

# Cards a plain count can check, by the dashboard's tag names. "no_success" is the sessions that
# tried, minus those with a success.
SESSION_COUNTS = {
    "all": f"SELECT COUNT(DISTINCT session_id) FROM session_telemetry_events WHERE {DAYS}",
    "tried": f"SELECT COUNT(*) FROM ({TRIED}) x",
    "failure": f"""SELECT COUNT(DISTINCT session_id) FROM session_telemetry_events e
        WHERE payload->>'event' = 'pipeline.connect.failure' AND {DAYS} AND {NOT_STALE}""",
    "repeated_attempts": f"""SELECT COUNT(*) FROM (SELECT session_id FROM session_telemetry_events
        WHERE payload->>'event' = 'pipeline.connect.attempt' AND {DAYS}
        GROUP BY session_id HAVING COUNT(*) > 1) x""",
    "no_success": f"""SELECT COUNT(*) FROM ({TRIED} EXCEPT SELECT session_id FROM session_telemetry_events
        WHERE payload->>'event' = 'pipeline.connect.success' AND {DAYS}) x""",
    "stream_drops": f"""SELECT COUNT(DISTINCT session_id) FROM session_telemetry_events
        WHERE payload->>'event' = 'webrtc.connection.state' AND payload->>'prev' = 'connected'
            AND payload->>'state' IN ('disconnected', 'failed') AND {DAYS}""",
}

# How each session ended up, from its last success, its last real error and its attempts.
# The checks run in the same order as outcome() in pipeline/rules.py, written out again here.
OUTCOME_COUNTS = f"""
WITH ends AS (
    SELECT session_id, MIN(recorded_at) AS ended_at FROM session_telemetry_events
    WHERE event_type = 'session_ended' GROUP BY session_id
), sessions AS (
    SELECT e.session_id,
        COUNT(*) FILTER (WHERE e.payload->>'event' = 'pipeline.connect.attempt') AS attempts,
        MAX(e.recorded_at) FILTER (WHERE e.payload->>'event' = 'pipeline.connect.success') AS success,
        MAX(e.recorded_at) FILTER (WHERE e.payload->>'event' = 'pipeline.connect.failure'
            AND (ends.ended_at IS NULL OR e.recorded_at < ends.ended_at)) AS failure
    FROM session_telemetry_events e LEFT JOIN ends ON ends.session_id = e.session_id
    WHERE {DAYS}
    GROUP BY e.session_id
)
SELECT CASE
        WHEN success IS NOT NULL AND failure IS NOT NULL AND success > failure THEN 'outcome_recovered'
        WHEN success IS NOT NULL AND failure IS NOT NULL THEN 'outcome_later_failed'
        WHEN success IS NOT NULL THEN 'outcome_connected'
        WHEN failure IS NOT NULL THEN 'outcome_failed'
        WHEN attempts > 0 THEN 'outcome_silent'
        ELSE 'outcome_not_tried' END AS outcome,
    COUNT(*) AS sessions
FROM sessions
GROUP BY 1"""

# Readings are checked the way the job reads them: a timestamp or value counts only when it is a
# number, and a frame rate only when it is at least 0 and finite.
# Batches that started up to an hour before the range are read too, since their later seconds can
# fall inside it. Only sessions with events on the chosen days count.
STREAM = """
WITH readings AS (
    SELECT s.session_id,
        CASE WHEN jsonb_typeof(s.samples->'ts'->i) = 'number' THEN (s.samples->'ts'->>i)::INT8 // 1000 END AS second,
        CASE WHEN jsonb_typeof(s.samples->'fps'->i) = 'number' THEN (s.samples->'fps'->>i)::FLOAT8 END AS fps,
        CASE WHEN jsonb_typeof(s.samples->'skippedFrames'->i) = 'number'
            THEN (s.samples->'skippedFrames'->>i)::FLOAT8 END AS skipped
    FROM session_telemetry_stats s, generate_series(0, jsonb_array_length(s.samples->'ts') - 1) AS i
    WHERE jsonb_typeof(s.samples->'ts') = 'array'
        AND s.bucket_start >= %(start)s::TIMESTAMPTZ - INTERVAL '1 hour' AND s.bucket_start < %(end)s::DATE + 1
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
    SELECT session_id, AVG(fps) FILTER (WHERE fps >= 0 AND fps < 'Infinity'::FLOAT8) AS fps
    FROM kept GROUP BY session_id
)
SELECT (SELECT COUNT(*) FROM seconds) AS streamed,
    (SELECT COUNT(*) FILTER (WHERE low) FROM seconds) AS low,
    (SELECT COUNT(*) FROM averages WHERE fps < 30) AS low_average,
    (SELECT COUNT(DISTINCT session_id) FROM seconds WHERE low) AS any_low,
    (SELECT COUNT(*) FROM (SELECT session_id FROM seconds GROUP BY session_id
        HAVING COUNT(*) FILTER (WHERE stutter) >= 0.1 * COUNT(*)) x) AS high_skip
""".format(days=DAYS)

# Time to video is the value sent with each session's first success; none when that success sent none.
WAITS = f"""SELECT (array_agg(CASE WHEN jsonb_typeof(payload->'timeToReadyMs') = 'number'
        THEN (payload->>'timeToReadyMs')::FLOAT8 END ORDER BY recorded_at))[1] / 1000 AS wait
    FROM session_telemetry_events
    WHERE payload->>'event' = 'pipeline.connect.success' AND {DAYS}
    GROUP BY session_id"""

# An error is an event with level 'error'. A connection state event counts as its error type only
# when its state is "failed"; its stage counts either way.
ERROR_TYPES = f"""SELECT COUNT(DISTINCT session_id) FROM session_telemetry_events e
    WHERE level = 'error' AND {DAYS} AND {NOT_STALE} AND payload->>'event' = %(value)s
        AND (payload->>'event' NOT IN ('webrtc.connection.state', 'ice.connection.state')
            OR payload->>'state' = 'failed')"""
# Sessions with an error from one stage, and sessions that ended for one exact reason.
ERROR_STAGES = f"""SELECT COUNT(DISTINCT session_id) FROM session_telemetry_events e
    WHERE level = 'error' AND {DAYS} AND {NOT_STALE} AND payload->>'stage' = %(value)s"""
ENDS = f"""SELECT COUNT(DISTINCT session_id) FROM session_telemetry_events
    WHERE payload->>'end_reason' = %(value)s AND {DAYS}"""

# The plain average of every valid reading of six measurements over the chosen days, for any
# session that has events at all, as the dashboard counts them.
MEASURES = """
SELECT measure, SUM(amount) / COUNT(*) AS average
FROM (
    SELECT s.session_id, m.key AS measure,
        CASE WHEN jsonb_typeof(s.samples->'ts'->i) = 'number' THEN (s.samples->'ts'->>i)::INT8 END AS ts,
        CASE WHEN jsonb_typeof(m.value->i) = 'number' THEN (m.value->>i)::FLOAT8 END AS amount
    FROM session_telemetry_stats s
    CROSS JOIN LATERAL jsonb_each(s.samples) AS m(key, value)
    CROSS JOIN LATERAL generate_series(0, jsonb_array_length(s.samples->'ts') - 1) AS i
    WHERE jsonb_typeof(s.samples->'ts') = 'array' AND jsonb_typeof(m.value) = 'array'
        AND m.key IN ('latency', 'jitter', 'bitrate', 'downloadSpeed', 'decodeDuration', 'encodeDuration')
) readings
WHERE amount >= 0 AND amount < 'Infinity'::FLOAT8
    AND ts >= EXTRACT(EPOCH FROM %(start)s::TIMESTAMPTZ) * 1000
    AND ts < EXTRACT(EPOCH FROM (%(end)s::DATE + 1)::TIMESTAMPTZ) * 1000
    AND session_id IN (SELECT session_id FROM session_telemetry_events)
GROUP BY measure"""

# Every error event with its code, stage, phase and reason, grouped the way the dashboard lists them.
ERROR_EVENT_GROUPS = f"""SELECT COALESCE(payload->>'code', payload->>'errorCode', '') AS code,
        COALESCE(payload->>'event', event_type::STRING) AS event,
        COALESCE(payload->>'stage', '') AS stage, COALESCE(payload->>'phase', '') AS phase,
        COALESCE(payload->>'reason', payload->>'errorText',
            CASE WHEN payload ? 'state' THEN COALESCE(payload->>'prev', '?') || ' → ' || (payload->>'state') END,
            NULLIF(message, COALESCE(payload->>'event', event_type::STRING)), '') AS reason,
        NOT ({NOT_STALE}) AS after_end, COUNT(DISTINCT session_id) AS sessions
    FROM session_telemetry_events e
    WHERE level = 'error' AND {DAYS}
    GROUP BY 1, 2, 3, 4, 5, 6"""


def nearest_rank(values, share):
    # The same nearest-rank pick as percentile_disc in the dashboard's SQL: always a value that occurred.
    values = sorted(values)
    return values[max(math.ceil(share * len(values)) - 1, 0)] if values else None


def error_key(row):
    # What tells error groups apart: the six parts of the dashboard's error filter.
    return row["code"], row["event"], row["stage"], row["phase"], row["reason"], row["after_end"]


def main():
    with db.connect() as connection:
        # Recounting from raw readings is slow; give it longer than a page request gets.
        connection.execute("SET statement_timeout = '900s'")
        dates = connection.execute(DATES).fetchone()
        # The dates given on the command line, or every recorded day.
        start, end = (sys.argv[1], sys.argv[2]) if len(sys.argv) == 3 else (str(dates["start"]), str(dates["end"]))
        # Start as UTC midnight; end stays a date so DAYS can add one day to it.
        params = {"start": f"{start} 00:00:00+00", "end": end}

        def one(sql, **extra):
            # A query that returns a single number.
            return next(iter(connection.execute(sql, {**params, **extra}).fetchone().values()))

        cards = {key: one(sql) for key, sql in SESSION_COUNTS.items()}
        found = {row["outcome"]: row["sessions"] for row in connection.execute(OUTCOME_COUNTS, params)}
        cards |= {key: found.get(key, 0) for key in OUTCOMES}
        cards |= {key: one(ERROR_TYPES, value=name) for key, name in ERROR_EVENTS.items()}
        cards |= {"stage_" + stage.lower(): one(ERROR_STAGES, value=stage) for stage in STAGES}
        cards |= {key: one(ENDS, value=reason) for key, reason in END_TAGS.items()}
        stream = connection.execute(STREAM, params).fetchone()
        cards |= {"low_fps": stream["low_average"], "any_low_fps": stream["any_low"], "high_skip": stream["high_skip"]}
        waits = [row["wait"] for row in connection.execute(WAITS, params).fetchall() if row["wait"] is not None]
        groups_found = {error_key(row): row["sessions"] for row in connection.execute(ERROR_EVENT_GROUPS, params)}
        measures = {row["measure"]: round(row["average"], 2) for row in connection.execute(MEASURES, params)}

    # The dashboard's own answer, asked through its API the way the page asks.
    client = Client()
    data = client.get("/api/impact/", {"start": start, "end": end}).json()
    summary, groups = data["summary"], data["summary"]["groups"]
    # Card counts are labelled with the dashboard's own titles.
    rows = [(groups[key]["title"], count, groups[key]["count"]) for key, count in cards.items()] + [
        ("Streamed hours", round(stream["streamed"] / 3600, 2), round(summary["streamed_hours"], 2)),
        ("Hours below 30 FPS", round(stream["low"] / 3600, 2), round(summary["low_fps_hours"], 2)),
        ("Typical wait (s)", nearest_rank(waits, 0.5), summary["ready_p50"]),
        ("1 in 10 waited over (s)", nearest_rank(waits, 0.9), summary["ready_p90"]),
    ] + [(f"Average {name}", average, round(summary["measures"][name]["average"], 2))
         for name, average in measures.items()]

    # Error events: compared as a whole, and only the counts are printed, never the text.
    shown = {error_key(row): row["sessions"] for row in data["error_events"]}
    # -1 when the two sides list different groups, so a mismatch can never pass by accident.
    rows.append(("Error event groups that match", len(groups_found), sum(
        shown.get(key) == count for key, count in groups_found.items()) if shown.keys() == groups_found.keys() else -1))

    print(f"{start} to {end}")
    print("Raw data against the dashboard:")
    # Every row that differs counts; any difference fails the check.
    failed = 0
    for name, expected, found_here in rows:
        failed += expected != found_here
        print(f"  {'ok  ' if expected == found_here else 'DIFF'}  {name:38} raw data {expected}  dashboard {found_here}")

    # The app against itself: every card's count equals the length of its own list, and the
    # outcome cards add up to all sessions.
    print("Consistency check (the dashboard against itself):")
    consistent = 0
    outcomes_total = sum(groups[key]["count"] for key in OUTCOMES)
    if outcomes_total != summary["sessions"]:
        consistent += 1
        print(f"  DIFF  Outcomes add up to {outcomes_total}, sessions {summary['sessions']}")
    for key, group in groups.items():
        listed = client.get("/api/impact/", {"start": start, "end": end, "category": key}).json()["sessions"]["total"]
        if listed != group["count"]:
            consistent += 1
            print(f"  DIFF  {group['title']}: card {group['count']}, list {listed}")
    print(f"  {'ok  ' if not consistent else 'DIFF'}  {len(groups)} cards match their lists; outcomes add up to "
          f"sessions: {outcomes_total == summary['sessions']}")
    failed += consistent
    print(f"{len(rows)} numbers and {len(groups)} lists checked: "
          + ("all match." if not failed else f"{failed} differ."))
    # A non-zero exit code tells whatever ran the check that something differed.
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
