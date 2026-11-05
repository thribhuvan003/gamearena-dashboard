-- The producer's readiness field is not an independently measured end-to-end delay.
WITH recorded AS (
    SELECT CASE WHEN jsonb_typeof(payload->'timeToReadyMs') = 'number'
                THEN (payload->>'timeToReadyMs')::FLOAT8 END AS amount
    FROM session_telemetry_events
    WHERE recorded_at >= %(start)s AND recorded_at < %(end)s
        AND payload ? 'timeToReadyMs'
), valid AS (
    SELECT amount FROM recorded WHERE amount >= 0 AND amount < 'Infinity'::FLOAT8
)
SELECT (SELECT COUNT(*) FROM recorded) AS entries,
    COUNT(*) AS valid, AVG(amount) AS mean,
    percentile_cont(0.5) WITHIN GROUP (ORDER BY amount) AS median,
    percentile_cont(0.95) WITHIN GROUP (ORDER BY amount) AS p95,
    MIN(amount) AS minimum, MAX(amount) AS maximum
FROM valid;
