-- Share stage counts, never private session IDs or error messages.
SELECT
    CASE WHEN payload->>'phase' IN ('pre-connect', 'connecting', 'connected', 'ended')
         THEN payload->>'phase' ELSE 'Not recorded / other' END AS phase,
    CASE WHEN payload->>'stage' IN ('Session', 'Config', 'Websocket', 'Device', 'Video', 'Audio', 'Input', 'Scream')
         THEN payload->>'stage' ELSE 'Not recorded / other' END AS stage,
    COUNT(*) AS events, COUNT(DISTINCT session_id) AS sessions
FROM session_telemetry_events
WHERE recorded_at >= %(start)s AND recorded_at < %(end)s
    AND payload->>'event' = 'pipeline.connect.failure'
GROUP BY 1, 2 ORDER BY events DESC;
