-- STEP 1: Check the imported data.
-- Read-only: SELECT queries only.
-- These are record counts, not connection success rates.

-- A. Total rows in both tables.
SELECT
    (SELECT COUNT(*) FROM session_telemetry_events) AS total_events,
    (SELECT COUNT(*) FROM session_telemetry_stats) AS total_stats;

-- B. How many different sessions and connections?
SELECT
    COUNT(DISTINCT session_id) AS unique_sessions,
    COUNT(DISTINCT connection_id) AS unique_connections,
    MIN(recorded_at) AS first_event_utc,
    MAX(recorded_at) AS last_event_utc
FROM session_telemetry_events;

-- C. How many sessions have performance statistics?
SELECT COUNT(DISTINCT session_id) AS sessions_with_stats
FROM session_telemetry_stats;

-- D. Which events are recorded? One session can have many events.
SELECT
    event_type,
    COUNT(*) AS event_count,
    COUNT(DISTINCT session_id) AS session_count
FROM session_telemetry_events
GROUP BY event_type
ORDER BY event_count DESC;
