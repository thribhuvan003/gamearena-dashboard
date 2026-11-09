-- ==== 01_data_check ====
-- STEP 1: Check the imported data.
-- Read-only: SELECT queries only.
-- These are record counts, not connection success rates.

-- A. Total rows in both tables.
SELECT
    (SELECT COUNT(*) FROM session_telemetry_events) AS total_events,
    (SELECT COUNT(*) FROM session_telemetry_stats) AS total_stats;

-- B. How many different sessions and connections?
SELECT
    COUNT(DISTINCT session_id) AS unique_sessions,
    COUNT(DISTINCT connection_id) AS unique_connections,
    MIN(recorded_at) AS first_event_utc,
    MAX(recorded_at) AS last_event_utc
FROM session_telemetry_events;

-- C. How many sessions have performance statistics?
SELECT COUNT(DISTINCT session_id) AS sessions_with_stats
FROM session_telemetry_stats;

-- D. Which events are recorded? One session can have many events.
SELECT
    event_type,
    COUNT(*) AS event_count,
    COUNT(DISTINCT session_id) AS session_count
FROM session_telemetry_events
GROUP BY event_type
ORDER BY event_count DESC;

-- ==== 02_session_counts ====
-- STEP 2: Count sessions correctly (each session only once).
-- 'No recorded success' is NOT proof of a permanent failure.
-- A session may have both results; these totals do not establish event order.

WITH session_flags AS (
    SELECT
        session_id,
        MAX(CASE WHEN payload->>'event' = 'pipeline.connect.attempt' THEN 1 ELSE 0 END) AS attempted,
        MAX(CASE WHEN payload->>'event' = 'pipeline.connect.success' THEN 1 ELSE 0 END) AS succeeded,
        MAX(CASE WHEN payload->>'event' = 'pipeline.connect.failure' THEN 1 ELSE 0 END) AS failed,
        MAX(CASE WHEN event_type = 'client_disconnected' THEN 1 ELSE 0 END) AS disconnected,
        MAX(CASE WHEN event_type = 'client_reconnected' THEN 1 ELSE 0 END) AS reconnected,
        MAX(CASE WHEN event_type = 'ws_error' THEN 1 ELSE 0 END) AS ws_error
    FROM session_telemetry_events
    GROUP BY session_id
)
SELECT
    COUNT(*) AS total_sessions,
    SUM(attempted) AS sessions_with_attempt,
    SUM(succeeded) AS sessions_with_success,
    SUM(failed) AS sessions_with_failure_event,
    SUM(disconnected) AS sessions_with_disconnect,
    SUM(reconnected) AS sessions_with_reconnect,
    SUM(ws_error) AS sessions_with_ws_error,
    SUM(CASE WHEN attempted = 1 AND succeeded = 0 THEN 1 ELSE 0 END)
        AS attempted_no_success_recorded,
    SUM(CASE WHEN failed = 1 AND succeeded = 1 THEN 1 ELSE 0 END)
        AS sessions_with_failure_and_success
FROM session_flags;

-- The totals above OVERLAP. For example, a session may fail, reconnect,
-- and later succeed. Do not add these categories together.

-- ==== 03_connection_issues ====
-- STEP 3: Find major connection issues without showing private rows.
-- This reports observed events and evidence, not proven root causes.

-- A. Pipeline attempts, successes, failures and drops.
SELECT
    payload->>'event' AS pipeline_event,
    COUNT(*) AS total_events,
    COUNT(DISTINCT session_id) AS affected_sessions,
    COUNT(*) FILTER (WHERE connection_id IS NULL) AS missing_connection_id
FROM session_telemetry_events
WHERE event_type = 'custom'
  AND payload->>'category' = 'pipeline'
GROUP BY payload->>'event'
ORDER BY total_events DESC;

-- B. Which phases and stages contain pipeline failures?
SELECT
    COALESCE(payload->>'phase', 'not_recorded') AS phase,
    COALESCE(payload->>'stage', 'not_recorded') AS stage,
    COUNT(*) AS failure_events,
    COUNT(DISTINCT session_id) AS affected_sessions,
    COUNT(*) FILTER (WHERE payload ? 'errorCode') AS with_error_code,
    COUNT(*) FILTER (WHERE payload ? 'reason') AS with_reason
FROM session_telemetry_events
WHERE payload->>'event' = 'pipeline.connect.failure'
GROUP BY 1, 2
ORDER BY failure_events DESC;

-- C. Which technical categories appear most often?
SELECT
    payload->>'category' AS category,
    payload->>'event' AS event_name,
    COUNT(*) AS total_events,
    COUNT(DISTINCT session_id) AS affected_sessions
FROM session_telemetry_events
WHERE event_type = 'custom'
GROUP BY 1, 2
ORDER BY total_events DESC;

-- ==== 04_performance_check ====
-- STEP 4: Verify metric coverage BEFORE calculating averages.
-- Arrays can contain null values; missing is not zero.
-- Units and meaning of each metric still need confirmation.

-- A. Which metric arrays are available?
SELECT
    COUNT(*) AS total_stat_rows,
    COUNT(*) FILTER (WHERE jsonb_typeof(samples->'ts') = 'array') AS rows_with_timestamps,
    COUNT(*) FILTER (WHERE jsonb_typeof(samples->'fps') = 'array') AS rows_with_fps,
    COUNT(*) FILTER (WHERE jsonb_typeof(samples->'latency') = 'array') AS rows_with_latency,
    COUNT(*) FILTER (WHERE jsonb_typeof(samples->'jitter') = 'array') AS rows_with_jitter,
    COUNT(*) FILTER (WHERE jsonb_typeof(samples->'bitrate') = 'array') AS rows_with_bitrate
FROM session_telemetry_stats;

-- B. Are the arrays the expected length? Counts of problem rows.
WITH lengths AS (
    SELECT
        sample_count,
        CASE WHEN jsonb_typeof(samples->'ts') = 'array'
             THEN jsonb_array_length(samples->'ts') END AS ts_length,
        CASE WHEN jsonb_typeof(samples->'fps') = 'array'
             THEN jsonb_array_length(samples->'fps') END AS fps_length,
        CASE WHEN jsonb_typeof(samples->'latency') = 'array'
             THEN jsonb_array_length(samples->'latency') END AS latency_length,
        CASE WHEN jsonb_typeof(samples->'jitter') = 'array'
             THEN jsonb_array_length(samples->'jitter') END AS jitter_length
    FROM session_telemetry_stats
)
SELECT
    COUNT(*) AS total_rows,
    COUNT(*) FILTER (WHERE ts_length IS NULL OR ts_length <> sample_count)
        AS timestamp_count_mismatch,
    COUNT(*) FILTER (WHERE fps_length IS NOT NULL AND fps_length <> ts_length)
        AS fps_length_mismatch,
    COUNT(*) FILTER (WHERE latency_length IS NOT NULL AND latency_length <> ts_length)
        AS latency_length_mismatch,
    COUNT(*) FILTER (WHERE jitter_length IS NOT NULL AND jitter_length <> ts_length)
        AS jitter_length_mismatch
FROM lengths;

