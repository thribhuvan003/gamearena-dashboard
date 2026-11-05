-- STEP 4: Verify metric coverage BEFORE calculating averages.
-- Arrays can contain null values; missing is not zero.
-- Units and meaning of each metric still need confirmation.

-- A. Which metric arrays are available?
SELECT
    COUNT(*) AS total_stat_rows,
    COUNT(*) FILTER (WHERE jsonb_typeof(samples->'ts') = 'array') AS rows_with_timestamps,
    COUNT(*) FILTER (WHERE jsonb_typeof(samples->'fps') = 'array') AS rows_with_fps,
    COUNT(*) FILTER (WHERE jsonb_typeof(samples->'latency') = 'array') AS rows_with_latency,
    COUNT(*) FILTER (WHERE jsonb_typeof(samples->'jitter') = 'array') AS rows_with_jitter,
    COUNT(*) FILTER (WHERE jsonb_typeof(samples->'bitrate') = 'array') AS rows_with_bitrate
FROM session_telemetry_stats;

-- B. Are the arrays the expected length? Counts of problem rows.
WITH lengths AS (
    SELECT
        sample_count,
        CASE WHEN jsonb_typeof(samples->'ts') = 'array'
             THEN jsonb_array_length(samples->'ts') END AS ts_length,
        CASE WHEN jsonb_typeof(samples->'fps') = 'array'
             THEN jsonb_array_length(samples->'fps') END AS fps_length,
        CASE WHEN jsonb_typeof(samples->'latency') = 'array'
             THEN jsonb_array_length(samples->'latency') END AS latency_length,
        CASE WHEN jsonb_typeof(samples->'jitter') = 'array'
             THEN jsonb_array_length(samples->'jitter') END AS jitter_length
    FROM session_telemetry_stats
)
SELECT
    COUNT(*) AS total_rows,
    COUNT(*) FILTER (WHERE ts_length IS NULL OR ts_length <> sample_count)
        AS timestamp_count_mismatch,
    COUNT(*) FILTER (WHERE fps_length IS NOT NULL AND fps_length <> ts_length)
        AS fps_length_mismatch,
    COUNT(*) FILTER (WHERE latency_length IS NOT NULL AND latency_length <> ts_length)
        AS latency_length_mismatch,
    COUNT(*) FILTER (WHERE jitter_length IS NOT NULL AND jitter_length <> ts_length)
        AS jitter_length_mismatch
FROM lengths;
