-- STEP 2: Count sessions correctly (each session only once).
-- 'No recorded success' is NOT proof of a permanent failure.
-- Some sessions have both failures and later successes.

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
