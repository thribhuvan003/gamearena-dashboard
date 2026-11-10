-- Queries for the session pop-up: one session's summary, errors, events, connections and
-- stream quality, read from that session's raw telemetry.
-- report: session_detail
-- One whole session. Its tags and reason come from session_tags.
-- Distinct counts are separate subqueries: CockroachDB 25.3 returned wrong DISTINCT
-- aggregates when they shared a SELECT with ordered array_agg.
WITH events AS (
    -- Every raw event of this session, with the app's own event name taken from the payload once.
    SELECT e.*, e.payload->>'event' AS name
    FROM session_telemetry_events e
    WHERE e.session_id = %(session_id)s
)
SELECT session_id,
    -- Start, recorded end and last event. With no end recorded, the last event stands in for it.
    MIN(recorded_at) FILTER (WHERE event_type = 'session_started') AS started_at,
    MAX(recorded_at) FILTER (WHERE event_type = 'session_ended') AS ended_at,
    MAX(recorded_at) AS last_event_at,
    -- Time to video sent with the first successful connect, as the job stores it.
    (array_agg(CASE WHEN jsonb_typeof(payload->'timeToReadyMs') = 'number'
            THEN (payload->>'timeToReadyMs')::FLOAT8 END ORDER BY recorded_at)
        FILTER (WHERE name = 'pipeline.connect.success'))[1] AS first_ready_ms,
    COUNT(*) AS events,
    (SELECT COUNT(*) FROM (SELECT DISTINCT connection_id FROM events
        WHERE connection_role = 'host' AND connection_id IS NOT NULL) ids) AS host_connections,
    (SELECT COUNT(*) FROM (SELECT DISTINCT connection_id FROM events
        WHERE connection_role = 'client' AND connection_id IS NOT NULL) ids) AS client_connections,
    COUNT(*) FILTER (WHERE name = 'pipeline.connect.attempt') AS attempts,
    COUNT(*) FILTER (WHERE event_type = 'client_disconnected') AS disconnects,
    COUNT(*) FILTER (WHERE event_type = 'client_reconnected') AS reconnects,
    COUNT(*) FILTER (WHERE level = 'warn') AS warnings,
    -- Connected, then lost the stream while playing.
    COUNT(*) FILTER (WHERE name = 'webrtc.connection.state' AND payload->>'prev' = 'connected'
        AND payload->>'state' IN ('disconnected', 'failed')) AS stream_drops,
    -- How it ended (e.g. "Not in use") and who joined (owner, external user, share link).
    -- Both are short fixed values.
    (array_agg(payload->>'end_reason' ORDER BY recorded_at)
        FILTER (WHERE event_type = 'session_ended'))[1] AS end_reason,
    (SELECT string_agg(mode, ', ' ORDER BY mode) FROM (SELECT DISTINCT payload->>'mode' AS mode FROM events
        WHERE payload->>'mode' IS NOT NULL) modes) AS access_modes,
    -- Statistics batches live in their own table, so they are counted on their own.
    (
        SELECT COUNT(*) FROM session_telemetry_stats WHERE session_id = %(session_id)s
    ) AS batches
FROM events
GROUP BY session_id;

-- report: session_errors
-- Each distinct error in one session, most frequent first, with what the app sent unchanged.
-- Connection errors send "reason" and network path errors "errorText"; the message field only
-- repeats the event's name there, so it counts as the reason only when it says something else.
-- Errors on or after the session's first end are marked, as in process_error_events:
-- the app keeps retrying after the session has closed.
-- The same error on every retry is one row, so the retries it came on are shown as "2" or "2-5".
WITH ends AS (
    -- When the session first ended, if it did.
    SELECT MIN(recorded_at) AS ended_at FROM session_telemetry_events
    WHERE session_id = %(session_id)s AND event_type = 'session_ended'
), errors AS (
    SELECT e.payload->>'event' AS pipeline_event, e.event_type::STRING AS event_type,
        e.source::STRING AS source, COALESCE(e.payload->>'code', e.payload->>'errorCode') AS error_code,
        e.payload->>'stage' AS stage, e.payload->>'phase' AS phase,
        e.payload->>'prev' AS prev, e.payload->>'state' AS state,
        CASE WHEN jsonb_typeof(e.payload->'attempt') = 'number'
            THEN (e.payload->>'attempt')::FLOAT8 END AS attempt,
        COALESCE(e.payload->>'reason', e.payload->>'errorText',
            NULLIF(e.message, COALESCE(e.payload->>'event', e.event_type::STRING))) AS reason,
        -- A session with no end recorded has no errors after its end.
        COALESCE(e.recorded_at >= ends.ended_at, FALSE) AS after_end, e.recorded_at
    FROM session_telemetry_events e CROSS JOIN ends
    WHERE e.session_id = %(session_id)s AND e.level = 'error'
)
SELECT pipeline_event, event_type, source, error_code, stage, phase, prev, state,
    CASE WHEN MIN(attempt) = MAX(attempt) THEN MIN(attempt)::STRING
        ELSE MIN(attempt)::STRING || '-' || MAX(attempt)::STRING END AS attempt,
    reason, after_end, COUNT(*) AS events, MIN(recorded_at) AS first_at, MAX(recorded_at) AS last_at
FROM errors
GROUP BY pipeline_event, event_type, source, error_code, stage, phase, prev, state, reason, after_end
ORDER BY events DESC, first_at;

-- report: session_tags
-- The whole-session tags and reason the pipeline stored for this session.
SELECT tags, why FROM session_analysis WHERE session_id = %(session_id)s;

-- report: session_events
-- One page of a session's events in time order, each with its message and fields exactly as sent.
WITH filtered AS (
    SELECT id, recorded_at, event_type, source, level, connection_id, connection_role, message, payload,
        payload->>'event' AS pipeline_event, payload->>'phase' AS phase,
        payload->>'stage' AS stage,
        -- Connection errors send "code"; network path errors send "errorCode".
        COALESCE(payload->>'code', payload->>'errorCode') AS error_code,
        CASE WHEN jsonb_typeof(payload->'timeToReadyMs') = 'number'
            THEN payload->'timeToReadyMs' END AS ready_ms
    FROM session_telemetry_events
    WHERE session_id = %(session_id)s
        -- An empty filter means all. "missing" picks events sent without a connection ID.
        AND (%(source)s = '' OR source::STRING = %(source)s)
        AND (%(level)s = '' OR level::STRING = %(level)s)
        AND (%(connection)s = '' OR connection_id::STRING = %(connection)s
            OR (%(connection)s = 'missing' AND connection_id IS NULL))
), page AS (
    -- The event ID breaks ties between events recorded at the same moment, so paging is stable.
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
WHERE session_id = %(session_id)s
GROUP BY connection_id
ORDER BY first_seen, connection_id;

-- report: session_metrics
-- Summary of each measurement over one whole session. Only finite numbers >= 0 are valid.
WITH readings AS (
    -- samples holds one array per measurement. This unpacks it into one row per reading. Anything
    -- that is not an object or an array reads as empty, so a malformed batch adds nothing.
    SELECT metric.key AS metric,
        CASE WHEN jsonb_typeof(item.value) = 'number' THEN item.value::STRING::FLOAT8 END AS amount
    FROM session_telemetry_stats
    CROSS JOIN LATERAL jsonb_each(
        CASE WHEN jsonb_typeof(samples) = 'object' THEN samples ELSE '{}'::JSONB END
    ) metric(key, items)
    CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(metric.items) = 'array' THEN metric.items ELSE '[]'::JSONB END
    ) item(value)
    -- ts holds the timestamps, not a measurement.
    WHERE session_id = %(session_id)s AND metric.key <> 'ts'
), checked AS (
    SELECT metric, amount,
        COALESCE(amount >= 0 AND amount < 'Infinity'::FLOAT8, FALSE) AS valid
    FROM readings
)
SELECT metric,
    COUNT(*) FILTER (WHERE valid) AS valid,
    -- Under 30 is the low-frame-rate line (LOW_FPS in pipeline/rules.py). Counted for every
    -- measurement, but it only means something for fps.
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
    WHERE session_id = %(session_id)s
), page AS (
    SELECT * FROM buckets ORDER BY bucket_start, id LIMIT %(limit)s OFFSET %(offset)s
), readings AS (
    -- Only the batches on this page are unpacked, so a long session's pages stay quick.
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
        -- Only finite numbers of 0 or more count, as in session_metrics.
        AVG(amount) FILTER (WHERE amount >= 0 AND amount < 'Infinity'::FLOAT8) AS mean,
        COUNT(*) FILTER (WHERE amount >= 0 AND amount < 'Infinity'::FLOAT8) AS valid
    FROM readings
    GROUP BY id, metric
), grouped AS (
    -- One row per batch on the page. The left join keeps a batch with no readings, and the FILTER
    -- keeps its empty measurement out of the object.
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
