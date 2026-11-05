-- Read the available calendar range instead of hard-coding three months.
SELECT MIN(first_day) AS start, MAX(last_day) AS end FROM (
    SELECT MIN(recorded_at)::DATE AS first_day, MAX(recorded_at)::DATE AS last_day
    FROM session_telemetry_events
    UNION ALL
    SELECT MIN(bucket_start)::DATE, MAX(bucket_start)::DATE
    FROM session_telemetry_stats
) AS dates;
