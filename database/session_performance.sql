-- report: session_numbers
SELECT stats.id, bucket_start, bucket_end, metric.key AS metric,
    jsonb_typeof(item.value) AS kind,
    CASE WHEN jsonb_typeof(item.value) = 'number' THEN item.value::STRING::FLOAT8 END AS amount
FROM session_telemetry_stats stats
CROSS JOIN LATERAL jsonb_each(
    CASE WHEN jsonb_typeof(samples) = 'object' THEN samples ELSE '{}'::JSONB END
) metric(key, items)
CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(metric.items) = 'array' THEN metric.items ELSE '[]'::JSONB END
) item(value)
WHERE session_id = %(session_id)s AND bucket_start >= %(start)s AND bucket_start < %(end)s
    AND metric.key <> 'ts';

-- report: session_metrics
WITH numbers AS ({session_numbers})
SELECT metric, COUNT(*) AS entries, COUNT(*) FILTER (WHERE kind = 'null') AS missing,
    COUNT(*) FILTER (WHERE kind <> 'null' AND NOT COALESCE(amount >= 0 AND amount < 'Infinity'::FLOAT8,FALSE)) AS invalid,
    COUNT(*) FILTER (WHERE amount >= 0 AND amount < 'Infinity'::FLOAT8) AS valid,
    AVG(amount) FILTER (WHERE amount >= 0 AND amount < 'Infinity'::FLOAT8) AS mean,
    MIN(amount) FILTER (WHERE amount >= 0 AND amount < 'Infinity'::FLOAT8) AS minimum,
    MAX(amount) FILTER (WHERE amount >= 0 AND amount < 'Infinity'::FLOAT8) AS maximum,
    stddev_pop(amount) FILTER (WHERE amount >= 0 AND amount < 'Infinity'::FLOAT8) AS deviation,
    percentile_cont(0.05) WITHIN GROUP (ORDER BY amount)
        FILTER (WHERE amount >= 0 AND amount < 'Infinity'::FLOAT8) AS p05
FROM numbers GROUP BY metric ORDER BY metric;

-- report: session_buckets
WITH buckets AS (
    SELECT id, bucket_start, bucket_end FROM session_telemetry_stats
    WHERE session_id = %(session_id)s AND bucket_start >= %(start)s AND bucket_start < %(end)s
), page AS (
    SELECT * FROM buckets ORDER BY bucket_start, id LIMIT %(limit)s OFFSET %(offset)s
), readings AS (
    SELECT stats.id, metric.key AS metric,
        AVG(CASE WHEN jsonb_typeof(item.value) = 'number' THEN
            CASE WHEN item.value::STRING::FLOAT8 >= 0 AND item.value::STRING::FLOAT8 < 'Infinity'::FLOAT8
            THEN item.value::STRING::FLOAT8 END END) AS mean,
        COUNT(*) FILTER (WHERE CASE WHEN jsonb_typeof(item.value) = 'number' THEN
            item.value::STRING::FLOAT8 >= 0 AND item.value::STRING::FLOAT8 < 'Infinity'::FLOAT8 ELSE FALSE END) AS valid
    FROM session_telemetry_stats stats JOIN page ON stats.id = page.id
    CROSS JOIN LATERAL jsonb_each(CASE WHEN jsonb_typeof(samples) = 'object' THEN samples ELSE '{}'::JSONB END) metric(key, items)
    CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(items) = 'array' THEN items ELSE '[]'::JSONB END) item(value)
    WHERE metric.key <> 'ts' GROUP BY stats.id, metric.key
), grouped AS (
    SELECT page.id, page.bucket_start, page.bucket_end,
        jsonb_object_agg(readings.metric, jsonb_build_object('mean',mean,'valid',valid))
            FILTER (WHERE readings.metric IS NOT NULL) AS metrics
    FROM page LEFT JOIN readings ON readings.id = page.id GROUP BY page.id, page.bucket_start, page.bucket_end
)
SELECT (SELECT COUNT(*) FROM buckets) AS total, CASE WHEN grouped.id IS NOT NULL THEN to_jsonb(grouped) END AS item
FROM (SELECT 1) seed LEFT JOIN grouped ON TRUE ORDER BY grouped.bucket_start, grouped.id;

-- report: session_page_metrics
-- Expand only the sessions on this page rather than transferring raw sample arrays.
WITH numbers AS (
    SELECT session_id, metric.key AS metric,
        CASE WHEN jsonb_typeof(item.value) = 'number' THEN item.value::STRING::FLOAT8 END AS amount
    FROM session_telemetry_stats stats
    CROSS JOIN LATERAL jsonb_each(CASE WHEN jsonb_typeof(samples) = 'object' THEN samples ELSE '{}'::JSONB END) metric(key, items)
    CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(items) = 'array' THEN items ELSE '[]'::JSONB END) item(value)
    WHERE session_id = ANY(%(session_ids)s) AND bucket_start >= %(start)s AND bucket_start < %(end)s
        AND metric.key IN ('fps', 'latency', 'bitrate')
)
SELECT session_id, metric, AVG(amount) AS mean FROM numbers
WHERE amount >= 0 AND amount < 'Infinity'::FLOAT8 GROUP BY session_id, metric;
