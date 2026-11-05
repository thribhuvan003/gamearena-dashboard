-- Count only the presence of approved fields, not their diagnostic contents.
SELECT field.name AS field, COUNT(*) AS occurrences,
    COUNT(DISTINCT session_id) AS sessions
FROM session_telemetry_events
CROSS JOIN (VALUES ('errorCode'), ('timeToReadyMs'), ('delayMs'), ('attempt'), ('stage')) AS field(name)
WHERE recorded_at >= %(start)s AND recorded_at < %(end)s
    AND payload ? field.name
GROUP BY field.name ORDER BY field.name;
