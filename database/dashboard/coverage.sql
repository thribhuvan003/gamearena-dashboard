-- Array coverage tells us which parts of the selected period have measurements.
SELECT COUNT(*) AS rows, COUNT(DISTINCT session_id) AS sessions,
    COUNT(*) FILTER (WHERE jsonb_typeof(samples->'fps') = 'array') AS fps,
    COUNT(*) FILTER (WHERE jsonb_typeof(samples->'latency') = 'array') AS latency,
    COUNT(*) FILTER (WHERE jsonb_typeof(samples->'jitter') = 'array') AS jitter,
    COUNT(*) FILTER (WHERE jsonb_typeof(samples->'bitrate') = 'array') AS bitrate
FROM session_telemetry_stats
WHERE bucket_start >= %(start)s AND bucket_start < %(end)s;
