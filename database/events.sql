-- report: session_events
WITH filtered AS (
    SELECT id, recorded_at, event_type, source, level, connection_id, connection_role,
        payload->>'event' AS pipeline_event, payload->>'phase' AS phase,
        payload->>'stage' AS stage, payload->>'errorCode' AS error_code,
        CASE WHEN jsonb_typeof(payload->'timeToReadyMs') = 'number'
             THEN payload->'timeToReadyMs' END AS ready_ms
    FROM session_telemetry_events
    WHERE session_id = %(session_id)s AND recorded_at >= %(start)s AND recorded_at < %(end)s
        AND (%(source)s = '' OR source::STRING = %(source)s)
        AND (%(level)s = '' OR level::STRING = %(level)s)
        AND (%(connection)s = '' OR connection_id::STRING = %(connection)s
             OR %(connection)s = 'missing' AND connection_id IS NULL)
), page AS (
    SELECT * FROM filtered ORDER BY recorded_at, id LIMIT %(limit)s OFFSET %(offset)s
)
SELECT (SELECT COUNT(*) FROM filtered) AS total, CASE WHEN page.id IS NOT NULL THEN to_jsonb(page) END AS item
FROM (SELECT 1) seed LEFT JOIN page ON TRUE ORDER BY page.recorded_at, page.id;

-- report: session_connections
SELECT connection_id, connection_role, source, MIN(recorded_at) AS first_seen,
    MAX(recorded_at) AS last_seen, COUNT(*) AS events,
    COUNT(*) FILTER (WHERE payload->>'event' = 'pipeline.connect.attempt') AS attempts,
    COUNT(*) FILTER (WHERE payload->>'event' = 'pipeline.connect.success') AS successes,
    COUNT(*) FILTER (WHERE payload->>'event' = 'pipeline.connect.failure') AS failures,
    COUNT(*) FILTER (WHERE event_type = 'client_disconnected') AS disconnects,
    COUNT(*) FILTER (WHERE event_type = 'client_reconnected') AS reconnects,
    COUNT(*) FILTER (WHERE level = 'error') AS errors
FROM session_telemetry_events
WHERE session_id = %(session_id)s AND recorded_at >= %(start)s AND recorded_at < %(end)s
GROUP BY connection_id, connection_role, source ORDER BY first_seen, connection_id;
