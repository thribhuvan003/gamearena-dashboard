-- report: investigation
-- Keep session-level questions separate from raw event totals.
WITH events AS (
    SELECT session_id, connection_id, event_type
    FROM session_telemetry_events
    WHERE recorded_at >= %(start)s AND recorded_at < %(end)s
), sessions AS (
    -- Count within each session before checking which behaviors repeated.
    SELECT session_id,
        COUNT(*) FILTER (WHERE event_type = 'ws_error') AS errors,
        COUNT(*) FILTER (WHERE event_type = 'client_reconnected') AS reconnects,
        COUNT(*) FILTER (WHERE event_type = 'client_disconnected') AS disconnects,
        COUNT(*) FILTER (WHERE event_type = 'session_started') AS starts,
        COUNT(*) FILTER (WHERE event_type = 'session_ended') AS ends,
        COUNT(DISTINCT connection_id) AS connections
    FROM events GROUP BY session_id
), measured AS (
    -- One row per measured ID prevents the batch join from multiplying events.
    SELECT DISTINCT session_id FROM session_telemetry_stats
    WHERE bucket_start >= %(start)s AND bucket_start < %(end)s
)
SELECT
    (SELECT COUNT(*) FROM events) AS event_records,
    (SELECT COUNT(DISTINCT connection_id) FROM events) AS connection_ids,
    COALESCE(SUM(errors), 0)::INT8 AS ws_error_events,
    COUNT(*) FILTER (WHERE errors > 0) AS ws_error_sessions,
    COUNT(*) FILTER (WHERE errors > 1) AS repeated_error_sessions,
    COALESCE(MAX(errors), 0) AS max_errors_in_one_session,
    COALESCE(SUM(reconnects), 0)::INT8 AS reconnect_events,
    COALESCE(SUM(reconnects) FILTER (WHERE reconnects > 1), 0)::INT8 AS repeat_events,
    COUNT(*) FILTER (WHERE reconnects > 0) AS reconnect_sessions,
    COUNT(*) FILTER (WHERE reconnects > 1) AS repeated_reconnect_sessions,
    COALESCE(MAX(reconnects), 0) AS max_reconnects_in_one_session,
    COALESCE(SUM(disconnects), 0)::INT8 AS disconnect_events,
    COALESCE(SUM(starts), 0)::INT8 AS start_events,
    COALESCE(SUM(ends), 0)::INT8 AS end_events,
    COUNT(*) FILTER (WHERE starts > 0 AND ends = 0) AS started_without_end,
    COUNT(*) FILTER (WHERE connections > 1) AS several_connection_sessions,
    COALESCE(MAX(connections), 0) AS max_connections_in_one_session,
    COUNT(*) FILTER (WHERE measured.session_id IS NOT NULL) AS matched_statistics,
    COUNT(*) FILTER (WHERE measured.session_id IS NULL) AS without_statistics
FROM sessions LEFT JOIN measured ON measured.session_id = sessions.session_id;

-- report: payload
-- Count only the presence of approved fields, not their diagnostic contents.
SELECT field.name AS field, COUNT(*) AS occurrences,
    COUNT(DISTINCT session_id) AS sessions
FROM session_telemetry_events
CROSS JOIN (VALUES ('errorCode'), ('timeToReadyMs'), ('delayMs'), ('attempt'), ('stage')) AS field(name)
WHERE recorded_at >= %(start)s AND recorded_at < %(end)s
    AND payload ? field.name
GROUP BY field.name ORDER BY field.name;

-- report: readiness
-- The producer's readiness field is not an independently measured end-to-end delay.
WITH recorded AS (
    SELECT CASE WHEN jsonb_typeof(payload->'timeToReadyMs') = 'number'
                THEN (payload->>'timeToReadyMs')::FLOAT8 END AS amount
    FROM session_telemetry_events
    WHERE recorded_at >= %(start)s AND recorded_at < %(end)s
        AND payload ? 'timeToReadyMs'
), valid AS (
    -- Only usable durations go into the timing summaries.
    SELECT amount FROM recorded WHERE amount >= 0 AND amount < 'Infinity'::FLOAT8
)
-- The median is the middle reading; the 95th percentile describes the slower end.
SELECT (SELECT COUNT(*) FROM recorded) AS entries,
    COUNT(*) AS valid, AVG(amount) AS mean,
    percentile_cont(0.5) WITHIN GROUP (ORDER BY amount) AS median,
    percentile_cont(0.95) WITHIN GROUP (ORDER BY amount) AS p95,
    MIN(amount) AS minimum, MAX(amount) AS maximum
FROM valid;
