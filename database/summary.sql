-- report: overview
-- One row per session prevents repeated events from inflating session totals.
WITH sessions AS ({session_rows})
-- Count the sessions with each flag. The same session can record success and failure.
SELECT COUNT(*) AS total,
    COUNT(*) FILTER (WHERE attempts > 0) AS attempted,
    COUNT(*) FILTER (WHERE success) AS succeeded,
    COUNT(*) FILTER (WHERE failure) AS failed,
    COUNT(*) FILTER (WHERE disconnects > 0) AS disconnected,
    COUNT(*) FILTER (WHERE reconnects > 0) AS reconnected,
    COUNT(*) FILTER (WHERE ws_errors > 0) AS ws_error,
    COUNT(*) FILTER (WHERE attempts > 1) AS repeated_attempts,
    COUNT(*) FILTER (WHERE attempts > 0 AND NOT success) AS no_success,
    COUNT(*) FILTER (WHERE failure AND success) AS both
FROM sessions;

-- report: trend
-- A session is counted once per UTC day; daily totals need not add to unique sessions.
WITH days AS (
    SELECT recorded_at::DATE AS day, session_id,
        BOOL_OR(COALESCE(payload->>'event' = 'pipeline.connect.success', FALSE)) AS success,
        BOOL_OR(COALESCE(payload->>'event' = 'pipeline.connect.failure', FALSE)) AS failure
    FROM session_telemetry_events
    WHERE recorded_at >= %(start)s AND recorded_at < %(end)s
    GROUP BY 1, 2
)
-- A session active on two dates belongs to both daily rows but only once in the period total.
SELECT day, COUNT(*) AS sessions,
    COUNT(*) FILTER (WHERE success) AS succeeded,
    COUNT(*) FILTER (WHERE failure) AS failed
FROM days GROUP BY day ORDER BY day;

-- report: range
-- Read the available calendar range instead of hard-coding three months.
-- Check both tables because a statistics batch can fall outside the event dates.
SELECT MIN(first_day) AS start, MAX(last_day) AS end FROM (
    SELECT MIN(recorded_at)::DATE AS first_day, MAX(recorded_at)::DATE AS last_day
    FROM session_telemetry_events
    UNION ALL
    SELECT MIN(bucket_start)::DATE, MAX(bucket_start)::DATE
    FROM session_telemetry_stats
) AS dates;

-- report: failures
-- Share stage counts, never private session IDs or error messages.
-- Group labels into known stages and count events separately from affected sessions.
SELECT
    CASE WHEN payload->>'phase' IN ('pre-connect', 'connecting', 'connected', 'ended')
         THEN payload->>'phase' ELSE 'Not recorded / other' END AS phase,
    CASE WHEN payload->>'stage' IN ('Session', 'Config', 'Websocket', 'Device', 'Video', 'Audio', 'Input', 'Scream')
         THEN payload->>'stage' ELSE 'Not recorded / other' END AS stage,
    COUNT(*) AS events, COUNT(DISTINCT session_id) AS sessions,
    COUNT(*) FILTER (WHERE connection_id IS NULL) AS missing_id
FROM session_telemetry_events
WHERE recorded_at >= %(start)s AND recorded_at < %(end)s
    AND payload->>'event' = 'pipeline.connect.failure'
GROUP BY 1, 2 ORDER BY events DESC;
