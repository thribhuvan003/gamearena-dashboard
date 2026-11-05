-- Discover field names and coverage, without returning any sample values.
SELECT bucket_start::DATE AS day, field.key AS metric, COUNT(*) AS present_rows,
    COUNT(*) FILTER (WHERE jsonb_typeof(field.items) = 'array') AS array_rows
FROM session_telemetry_stats AS stats
CROSS JOIN LATERAL jsonb_each(
    CASE WHEN jsonb_typeof(stats.samples) = 'object' THEN stats.samples ELSE '{}'::JSONB END
) AS field(key, items)
WHERE bucket_start >= %(start)s AND bucket_start < %(end)s
    AND field.key <> 'ts'
GROUP BY day, field.key ORDER BY day, field.key;
