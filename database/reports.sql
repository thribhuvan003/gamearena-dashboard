-- report: coverage
-- Count measured sessions and available measurement arrays for the selected dates.
SELECT COUNT(*) AS rows, COUNT(DISTINCT session_id) AS sessions,
    COUNT(*) FILTER (WHERE jsonb_typeof(samples->'fps') = 'array') AS fps,
    COUNT(*) FILTER (WHERE jsonb_typeof(samples->'latency') = 'array') AS latency,
    COUNT(*) FILTER (WHERE jsonb_typeof(samples->'jitter') = 'array') AS jitter,
    COUNT(*) FILTER (WHERE jsonb_typeof(samples->'bitrate') = 'array') AS bitrate
FROM session_telemetry_stats
WHERE bucket_start >= %(start)s AND bucket_start < %(end)s;

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

-- report: inventory
-- Discover field names and coverage, without returning any sample values.
SELECT bucket_start::DATE AS day, field.key AS metric, COUNT(*) AS present_rows,
    COUNT(*) FILTER (WHERE jsonb_typeof(field.items) = 'array') AS array_rows
FROM session_telemetry_stats AS stats
-- Inspect each batch's keys so newly recorded measurement fields appear automatically.
CROSS JOIN LATERAL jsonb_each(
    CASE WHEN jsonb_typeof(stats.samples) = 'object' THEN stats.samples ELSE '{}'::JSONB END
) AS field(key, items)
WHERE bucket_start >= %(start)s AND bucket_start < %(end)s
    AND field.key <> 'ts'
GROUP BY day, field.key ORDER BY day, field.key;

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

-- report: metrics
-- Only aggregate numbers leave the database; individual samples stay here.
WITH numbers AS (
    SELECT bucket_start::DATE AS day, metric.key AS metric, jsonb_typeof(item.value) AS kind,
        CASE WHEN jsonb_typeof(item.value) = 'number'
             THEN item.value::STRING::FLOAT8 END AS amount
    FROM session_telemetry_stats AS stats
    CROSS JOIN LATERAL jsonb_each(
        CASE WHEN jsonb_typeof(stats.samples) = 'object' THEN stats.samples ELSE '{}'::JSONB END
    ) AS metric(key, items)
    -- Expand the list into readings; an absent or non-array field contributes none.
    CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(metric.items) = 'array' THEN metric.items ELSE '[]'::JSONB END
    ) AS item(value)
    WHERE bucket_start >= %(start)s AND bucket_start < %(end)s
        AND metric.key <> 'ts'
), checked AS (
    -- Negative, non-numeric and non-finite entries are excluded, never changed to zero.
    SELECT *, amount >= 0 AND amount < 'Infinity'::FLOAT8 AS valid FROM numbers
)
-- Day totals can be reused when the founder selects another date range.
SELECT day, metric, COUNT(*) AS entries,
    COUNT(*) FILTER (WHERE kind = 'null') AS missing,
    COUNT(*) FILTER (WHERE NOT COALESCE(valid, FALSE) AND kind <> 'null') AS invalid,
    COUNT(*) FILTER (WHERE valid) AS valid,
    SUM(amount) FILTER (WHERE valid) AS total,
    MIN(amount) FILTER (WHERE valid) AS minimum,
    MAX(amount) FILTER (WHERE valid) AS maximum
FROM checked GROUP BY day, metric ORDER BY day, metric;

-- report: overview
-- One row per session prevents repeated events from inflating session totals.
WITH sessions AS (
    SELECT session_id,
        COUNT(*) FILTER (WHERE payload->>'event' = 'pipeline.connect.attempt') AS attempts,
        BOOL_OR(COALESCE(payload->>'event' = 'pipeline.connect.success', FALSE)) AS success,
        BOOL_OR(COALESCE(payload->>'event' = 'pipeline.connect.failure', FALSE)) AS failure,
        BOOL_OR(event_type = 'client_disconnected') AS disconnected,
        BOOL_OR(event_type = 'client_reconnected') AS reconnected,
        BOOL_OR(event_type = 'ws_error') AS ws_error
    FROM session_telemetry_events
    WHERE recorded_at >= %(start)s AND recorded_at < %(end)s
    GROUP BY session_id
)
-- Count the sessions with each flag. The same session can record success and failure.
SELECT COUNT(*) AS total,
    COUNT(*) FILTER (WHERE attempts > 0) AS attempted,
    COUNT(*) FILTER (WHERE success) AS succeeded,
    COUNT(*) FILTER (WHERE failure) AS failed,
    COUNT(*) FILTER (WHERE disconnected) AS disconnected,
    COUNT(*) FILTER (WHERE reconnected) AS reconnected,
    COUNT(*) FILTER (WHERE ws_error) AS ws_error,
    COUNT(*) FILTER (WHERE attempts > 1) AS repeated_attempts,
    COUNT(*) FILTER (WHERE attempts > 0 AND NOT success) AS no_success,
    COUNT(*) FILTER (WHERE failure AND success) AS both
FROM sessions;

-- report: payload
-- Count only the presence of approved fields, not their diagnostic contents.
SELECT field.name AS field, COUNT(*) AS occurrences,
    COUNT(DISTINCT session_id) AS sessions
FROM session_telemetry_events
CROSS JOIN (VALUES ('errorCode'), ('timeToReadyMs'), ('delayMs'), ('attempt'), ('stage')) AS field(name)
WHERE recorded_at >= %(start)s AND recorded_at < %(end)s
    AND payload ? field.name
GROUP BY field.name ORDER BY field.name;

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
