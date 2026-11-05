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
