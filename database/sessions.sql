-- report: session_rows
-- The overview and explorer share this one row per event-observed session.
SELECT e.session_id, MIN(recorded_at) AS first_seen, MAX(recorded_at) AS last_seen,
    MIN(recorded_at) FILTER (WHERE event_type = 'session_started') AS started_at,
    MAX(recorded_at) FILTER (WHERE event_type = 'session_ended') AS ended_at,
    MIN(recorded_at) FILTER (WHERE payload->>'event' = 'pipeline.connect.failure') AS first_failure_at,
    MAX(recorded_at) FILTER (WHERE payload->>'event' = 'pipeline.connect.success') AS last_success_at,
    COUNT(*) AS events, COUNT(DISTINCT connection_id) AS connections,
    COUNT(DISTINCT connection_id) FILTER (WHERE connection_role = 'host') AS host_connections,
    COUNT(DISTINCT connection_id) FILTER (WHERE connection_role = 'client') AS client_connections,
    COUNT(*) FILTER (WHERE payload->>'event' = 'pipeline.connect.attempt') AS attempts,
    BOOL_OR(COALESCE(payload->>'event' = 'pipeline.connect.success', FALSE)) AS success,
    BOOL_OR(COALESCE(payload->>'event' = 'pipeline.connect.failure', FALSE)) AS failure,
    COUNT(*) FILTER (WHERE event_type = 'client_connected') AS client_connected,
    COUNT(*) FILTER (WHERE event_type = 'client_disconnected') AS disconnects,
    COUNT(*) FILTER (WHERE event_type = 'client_reconnected') AS reconnects,
    COUNT(*) FILTER (WHERE event_type = 'ws_error') AS ws_errors,
    COUNT(*) FILTER (WHERE level = 'error') AS errors,
    COUNT(*) FILTER (WHERE level = 'warn') AS warnings,
    COUNT(*) FILTER (WHERE CASE WHEN jsonb_typeof(payload->'timeToReadyMs') = 'number' THEN
        (payload->>'timeToReadyMs')::FLOAT8 >= 0
        AND (payload->>'timeToReadyMs')::FLOAT8 < 'Infinity'::FLOAT8 ELSE FALSE END) AS ready_count,
    COALESCE(MAX(measured.batches), 0) AS batches
FROM session_telemetry_events e
LEFT JOIN (
    SELECT session_id, COUNT(*) AS batches FROM session_telemetry_stats
    WHERE bucket_start >= %(start)s AND bucket_start < %(end)s GROUP BY session_id
) measured ON measured.session_id = e.session_id
WHERE recorded_at >= %(start)s AND recorded_at < %(end)s
GROUP BY e.session_id;

-- report: session_list
WITH sessions AS ({session_rows}), filtered AS (
    SELECT * FROM sessions s WHERE {filter}
    AND {performance_filter}
    AND (%(search)s = '' OR strpos(session_id::STRING, %(search)s) > 0)
    AND (%(stage)s = '' AND %(phase)s = '' OR EXISTS (
        SELECT 1 FROM session_telemetry_events e WHERE e.session_id = s.session_id
        AND recorded_at >= %(start)s AND recorded_at < %(end)s
        AND payload->>'event' = 'pipeline.connect.failure'
        AND (%(stage)s = '' OR
            CASE WHEN payload->>'stage' IN ('Session','Config','Websocket','Device','Video','Audio','Input','Scream')
                 THEN payload->>'stage' ELSE 'Not recorded / other' END = %(stage)s)
        AND (%(phase)s = '' OR
            CASE WHEN payload->>'phase' IN ('pre-connect','connecting','connected','ended')
                 THEN payload->>'phase' ELSE 'Not recorded / other' END = %(phase)s)
    ))
), page AS (
    SELECT * FROM filtered ORDER BY {sort}, session_id LIMIT %(limit)s OFFSET %(offset)s
)
-- A left join preserves the total even when the requested page is empty.
SELECT (SELECT COUNT(*) FROM filtered) AS total, CASE WHEN page.session_id IS NOT NULL THEN to_jsonb(page) END AS item FROM (SELECT 1) seed
LEFT JOIN page ON TRUE ORDER BY {sort}, page.session_id;

-- report: session_detail
SELECT * FROM ({session_rows}) sessions WHERE session_id = %(session_id)s;

-- report: session_fps_filter
s.session_id IN (
    SELECT session_id FROM session_telemetry_stats stats
    CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(samples->'fps') = 'array' THEN samples->'fps' ELSE '[]'::JSONB END
    ) item(value)
    WHERE bucket_start >= %(start)s AND bucket_start < %(end)s
    GROUP BY session_id
    HAVING AVG(CASE WHEN jsonb_typeof(item.value) = 'number' THEN
        CASE WHEN item.value::STRING::FLOAT8 >= 0 AND item.value::STRING::FLOAT8 < 'Infinity'::FLOAT8
             THEN item.value::STRING::FLOAT8 END END) < %(fps_below)s
);

-- report: session_range
SELECT MIN(day) AS start, MAX(day) AS end FROM (
    SELECT recorded_at::DATE AS day FROM session_telemetry_events WHERE session_id = %(session_id)s
    UNION ALL
    SELECT bucket_start::DATE FROM session_telemetry_stats WHERE session_id = %(session_id)s
) history;
