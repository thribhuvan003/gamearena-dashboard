-- report: session_detail
-- One session inside the selected dates. Its tags and reason come from session_tags.
-- Distinct counts are separate subqueries: CockroachDB 25.3 returned wrong DISTINCT
-- aggregates when they shared a SELECT with ordered array_agg.
WITH events AS (
    SELECT e.*, e.payload->>'event' AS name
    FROM session_telemetry_events e
    WHERE e.session_id = %(session_id)s AND e.recorded_at >= %(start)s AND e.recorded_at < %(end)s
)
SELECT session_id,
    MIN(recorded_at) FILTER (WHERE event_type = 'session_started') AS started_at,
    MAX(recorded_at) FILTER (WHERE event_type = 'session_ended') AS ended_at,
    MAX(recorded_at) AS last_event_at,
    (array_agg((payload->>'timeToReadyMs')::FLOAT8 ORDER BY recorded_at)
        FILTER (WHERE name = 'pipeline.connect.success'
            AND jsonb_typeof(payload->'timeToReadyMs') = 'number'))[1] AS first_ready_ms,
    COUNT(*) AS events,
    (SELECT COUNT(*) FROM (SELECT DISTINCT connection_id FROM events
        WHERE connection_role = 'host' AND connection_id IS NOT NULL) ids) AS host_connections,
    (SELECT COUNT(*) FROM (SELECT DISTINCT connection_id FROM events
        WHERE connection_role = 'client' AND connection_id IS NOT NULL) ids) AS client_connections,
    COUNT(*) FILTER (WHERE name = 'pipeline.connect.attempt') AS attempts,
    COUNT(*) FILTER (WHERE event_type = 'client_disconnected') AS disconnects,
    COUNT(*) FILTER (WHERE event_type = 'client_reconnected') AS reconnects,
    COUNT(*) FILTER (WHERE level = 'error') AS errors,
    COUNT(*) FILTER (WHERE level = 'warn') AS warnings,
    -- Connected, then lost the stream while playing.
    COUNT(*) FILTER (WHERE name = 'webrtc.connection.state' AND payload->>'prev' = 'connected'
        AND payload->>'state' IN ('disconnected', 'failed')) AS stream_drops,
    -- How it ended (e.g. "Not in use") and who joined (owner, external user, share link).
    -- Both are short fixed values.
    (array_agg(payload->>'end_reason' ORDER BY recorded_at)
        FILTER (WHERE event_type = 'session_ended'))[1] AS end_reason,
    -- The app's own reason for its latest connection error, as sent. The message field only
    -- repeats the event's name, so the reason comes first.
    (array_agg(COALESCE(payload->>'reason', payload->>'errorText', message) ORDER BY recorded_at DESC)
        FILTER (WHERE name = 'pipeline.connect.failure'))[1] AS last_error_message,
    (SELECT string_agg(mode, ', ' ORDER BY mode) FROM (SELECT DISTINCT payload->>'mode' AS mode FROM events
        WHERE payload->>'mode' IS NOT NULL) modes) AS access_modes,
    (
        SELECT COUNT(*) FROM session_telemetry_stats
        WHERE session_id = %(session_id)s AND bucket_start >= %(start)s AND bucket_start < %(end)s
    ) AS batches
FROM events
GROUP BY session_id;

-- report: session_range
-- First and last recorded day of one session, for "whole session" mode.
SELECT MIN(day) AS start, MAX(day) AS end FROM (
    SELECT recorded_at::DATE AS day FROM session_telemetry_events WHERE session_id = %(session_id)s
    UNION ALL
    SELECT bucket_start::DATE FROM session_telemetry_stats WHERE session_id = %(session_id)s
) history;

-- report: session_tags
-- The whole-session tags and reason the processor stored for this session.
SELECT tags, why FROM session_analysis WHERE session_id = %(session_id)s;

-- report: session_events
-- One page of a session's events in time order, each with its message and fields exactly as sent.
WITH filtered AS (
    SELECT id, recorded_at, event_type, source, level, connection_id, connection_role, message, payload,
        payload->>'event' AS pipeline_event, payload->>'phase' AS phase,
        payload->>'stage' AS stage,
        -- Connection errors send "code"; network route errors send "errorCode".
        COALESCE(payload->>'code', payload->>'errorCode') AS error_code,
        CASE WHEN jsonb_typeof(payload->'timeToReadyMs') = 'number'
            THEN payload->'timeToReadyMs' END AS ready_ms
    FROM session_telemetry_events
    WHERE session_id = %(session_id)s AND recorded_at >= %(start)s AND recorded_at < %(end)s
        AND (%(source)s = '' OR source::STRING = %(source)s)
        AND (%(level)s = '' OR level::STRING = %(level)s)
        AND (%(connection)s = '' OR connection_id::STRING = %(connection)s
            OR (%(connection)s = 'missing' AND connection_id IS NULL))
), page AS (
    SELECT * FROM filtered ORDER BY recorded_at, id LIMIT %(limit)s OFFSET %(offset)s
)
-- The left join keeps the total even when the requested page is past the end.
SELECT (SELECT COUNT(*) FROM filtered) AS total,
    CASE WHEN page.id IS NOT NULL THEN to_jsonb(page) END AS item
FROM (SELECT 1) seed
LEFT JOIN page ON TRUE
ORDER BY page.recorded_at, page.id;

-- report: session_connections
-- One row per connection. Events with no connection ID (connect attempts among them)
-- share one row, so nothing is dropped.
SELECT connection_id,
    string_agg(DISTINCT connection_role::STRING, ', ') AS roles,
    string_agg(DISTINCT source::STRING, ', ') AS sources,
    MIN(recorded_at) AS first_seen, MAX(recorded_at) AS last_seen,
    COUNT(*) FILTER (WHERE payload->>'event' = 'pipeline.connect.attempt') AS attempts,
    COUNT(*) FILTER (WHERE payload->>'event' = 'pipeline.connect.success') AS successes,
    COUNT(*) FILTER (WHERE payload->>'event' = 'pipeline.connect.failure') AS failures,
    COUNT(*) FILTER (WHERE event_type = 'client_disconnected') AS disconnects,
    COUNT(*) FILTER (WHERE event_type = 'client_reconnected') AS reconnects
FROM session_telemetry_events
WHERE session_id = %(session_id)s AND recorded_at >= %(start)s AND recorded_at < %(end)s
GROUP BY connection_id
ORDER BY first_seen, connection_id;

-- report: session_metrics
-- Summary of each measurement over one session. Only finite numbers >= 0 are valid.
WITH readings AS (
    SELECT metric.key AS metric,
        CASE WHEN jsonb_typeof(item.value) = 'number' THEN item.value::STRING::FLOAT8 END AS amount
    FROM session_telemetry_stats
    CROSS JOIN LATERAL jsonb_each(
        CASE WHEN jsonb_typeof(samples) = 'object' THEN samples ELSE '{}'::JSONB END
    ) metric(key, items)
    CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(metric.items) = 'array' THEN metric.items ELSE '[]'::JSONB END
    ) item(value)
    WHERE session_id = %(session_id)s AND bucket_start >= %(start)s AND bucket_start < %(end)s
        AND metric.key <> 'ts'
), checked AS (
    SELECT metric, amount,
        COALESCE(amount >= 0 AND amount < 'Infinity'::FLOAT8, FALSE) AS valid
    FROM readings
)
SELECT metric,
    COUNT(*) FILTER (WHERE valid) AS valid,
    COUNT(*) FILTER (WHERE valid AND amount < 30) AS under_30,
    COUNT(*) FILTER (WHERE NOT valid) AS missing,
    AVG(amount) FILTER (WHERE valid) AS mean,
    MIN(amount) FILTER (WHERE valid) AS minimum,
    MAX(amount) FILTER (WHERE valid) AS maximum
FROM checked
GROUP BY metric
ORDER BY metric;

-- report: session_buckets
-- One page of a session's statistics batches, each with the mean of every measurement.
WITH buckets AS (
    SELECT id, bucket_start, bucket_end FROM session_telemetry_stats
    WHERE session_id = %(session_id)s AND bucket_start >= %(start)s AND bucket_start < %(end)s
), page AS (
    SELECT * FROM buckets ORDER BY bucket_start, id LIMIT %(limit)s OFFSET %(offset)s
), readings AS (
    SELECT stats.id, metric.key AS metric,
        CASE WHEN jsonb_typeof(item.value) = 'number' THEN item.value::STRING::FLOAT8 END AS amount
    FROM session_telemetry_stats stats
    JOIN page ON stats.id = page.id
    CROSS JOIN LATERAL jsonb_each(
        CASE WHEN jsonb_typeof(samples) = 'object' THEN samples ELSE '{}'::JSONB END
    ) metric(key, items)
    CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(items) = 'array' THEN items ELSE '[]'::JSONB END
    ) item(value)
    WHERE metric.key <> 'ts'
), means AS (
    SELECT id, metric,
        AVG(amount) FILTER (WHERE amount >= 0 AND amount < 'Infinity'::FLOAT8) AS mean,
        COUNT(*) FILTER (WHERE amount >= 0 AND amount < 'Infinity'::FLOAT8) AS valid
    FROM readings
    GROUP BY id, metric
), grouped AS (
    SELECT page.id, page.bucket_start, page.bucket_end,
        jsonb_object_agg(means.metric, jsonb_build_object('mean', means.mean, 'valid', means.valid))
            FILTER (WHERE means.metric IS NOT NULL) AS metrics
    FROM page
    LEFT JOIN means ON means.id = page.id
    GROUP BY page.id, page.bucket_start, page.bucket_end
)
-- The left join keeps the total even when the requested page is past the end.
SELECT (SELECT COUNT(*) FROM buckets) AS total,
    CASE WHEN grouped.id IS NOT NULL THEN to_jsonb(grouped) END AS item
FROM (SELECT 1) seed
LEFT JOIN grouped ON TRUE
ORDER BY grouped.bucket_start, grouped.id;
