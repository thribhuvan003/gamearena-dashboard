-- Only aggregate numbers leave the database; individual samples stay here.
WITH numbers AS (
    SELECT bucket_start::DATE AS day, metric.key AS metric, jsonb_typeof(item.value) AS kind,
        CASE WHEN jsonb_typeof(item.value) = 'number'
             THEN item.value::STRING::FLOAT8 END AS amount
    FROM session_telemetry_stats AS stats
    CROSS JOIN LATERAL jsonb_each(
        CASE WHEN jsonb_typeof(stats.samples) = 'object' THEN stats.samples ELSE '{}'::JSONB END
    ) AS metric(key, items)
    CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(metric.items) = 'array' THEN metric.items ELSE '[]'::JSONB END
    ) AS item(value)
    WHERE bucket_start >= %(start)s AND bucket_start < %(end)s
        AND metric.key <> 'ts'
), checked AS (
    -- Negative, non-numeric and non-finite entries are excluded, never changed to zero.
    SELECT *, amount >= 0 AND amount < 'Infinity'::FLOAT8 AS valid FROM numbers
)
-- Day totals can be reused when the founder selects another date range.
SELECT day, metric, COUNT(*) AS entries,
    COUNT(*) FILTER (WHERE kind = 'null') AS missing,
    COUNT(*) FILTER (WHERE NOT COALESCE(valid, FALSE) AND kind <> 'null') AS invalid,
    COUNT(*) FILTER (WHERE valid) AS valid,
    SUM(amount) FILTER (WHERE valid) AS total,
    MIN(amount) FILTER (WHERE valid) AS minimum,
    MAX(amount) FILTER (WHERE valid) AS maximum
FROM checked GROUP BY day, metric ORDER BY day, metric;
