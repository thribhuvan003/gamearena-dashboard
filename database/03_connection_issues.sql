-- STEP 3: Find major connection issues without showing private rows.
-- This reports observed events and evidence, not proven root causes.

-- A. Pipeline attempts, successes, failures and drops.
SELECT
    payload->>'event' AS pipeline_event,
    COUNT(*) AS total_events,
    COUNT(DISTINCT session_id) AS affected_sessions,
    COUNT(*) FILTER (WHERE connection_id IS NULL) AS missing_connection_id
FROM session_telemetry_events
WHERE event_type = 'custom'
  AND payload->>'category' = 'pipeline'
GROUP BY payload->>'event'
ORDER BY total_events DESC;

-- B. Which phases and stages contain pipeline failures?
SELECT
    COALESCE(payload->>'phase', 'not_recorded') AS phase,
    COALESCE(payload->>'stage', 'not_recorded') AS stage,
    COUNT(*) AS failure_events,
    COUNT(DISTINCT session_id) AS affected_sessions,
    COUNT(*) FILTER (WHERE payload ? 'errorCode') AS with_error_code,
    COUNT(*) FILTER (WHERE payload ? 'reason') AS with_reason
FROM session_telemetry_events
WHERE payload->>'event' = 'pipeline.connect.failure'
GROUP BY 1, 2
ORDER BY failure_events DESC;

-- C. Which technical categories appear most often?
SELECT
    payload->>'category' AS category,
    payload->>'event' AS event_name,
    COUNT(*) AS total_events,
    COUNT(DISTINCT session_id) AS affected_sessions
FROM session_telemetry_events
WHERE event_type = 'custom'
GROUP BY 1, 2
ORDER BY total_events DESC;
