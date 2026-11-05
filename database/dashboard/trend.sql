-- A session is counted once per UTC day; daily totals need not add to unique sessions.
WITH days AS (
    SELECT recorded_at::DATE AS day, session_id,
        BOOL_OR(COALESCE(payload->>'event' = 'pipeline.connect.success', FALSE)) AS success,
        BOOL_OR(COALESCE(payload->>'event' = 'pipeline.connect.failure', FALSE)) AS failure
    FROM session_telemetry_events
    WHERE recorded_at >= %(start)s AND recorded_at < %(end)s
    GROUP BY 1, 2
)
SELECT day, COUNT(*) AS sessions,
    COUNT(*) FILTER (WHERE success) AS succeeded,
    COUNT(*) FILTER (WHERE failure) AS failed
FROM days GROUP BY day ORDER BY day;
