-- Keep session-level questions separate from raw event totals.
WITH events AS (
    SELECT session_id, connection_id, event_type
    FROM session_telemetry_events
    WHERE recorded_at >= %(start)s AND recorded_at < %(end)s
), sessions AS (
    SELECT session_id,
        COUNT(*) FILTER (WHERE event_type = 'ws_error') AS errors,
        COUNT(*) FILTER (WHERE event_type = 'client_reconnected') AS reconnects,
        COUNT(*) FILTER (WHERE event_type = 'client_disconnected') AS disconnects,
        COUNT(*) FILTER (WHERE event_type = 'session_started') AS starts,
        COUNT(*) FILTER (WHERE event_type = 'session_ended') AS ends,
        COUNT(DISTINCT connection_id) AS connections
    FROM events GROUP BY session_id
), measured AS (
    SELECT DISTINCT session_id FROM session_telemetry_stats
    WHERE bucket_start >= %(start)s AND bucket_start < %(end)s
)
SELECT
    (SELECT COUNT(*) FROM events) AS event_records,
    (SELECT COUNT(DISTINCT connection_id) FROM events) AS connection_ids,
    COALESCE(SUM(errors), 0)::INT8 AS ws_error_events,
    COUNT(*) FILTER (WHERE errors > 0) AS ws_error_sessions,
    COUNT(*) FILTER (WHERE errors > 1) AS repeated_error_sessions,
    COALESCE(MAX(errors), 0) AS max_errors_in_one_session,
    COALESCE(SUM(reconnects), 0)::INT8 AS reconnect_events,
    COUNT(*) FILTER (WHERE reconnects > 0) AS reconnect_sessions,
    COUNT(*) FILTER (WHERE reconnects > 1) AS repeated_reconnect_sessions,
    COALESCE(MAX(reconnects), 0) AS max_reconnects_in_one_session,
    COALESCE(SUM(disconnects), 0)::INT8 AS disconnect_events,
    COALESCE(SUM(starts), 0)::INT8 AS start_events,
    COALESCE(SUM(ends), 0)::INT8 AS end_events,
    COUNT(*) FILTER (WHERE starts > 0 AND ends = 0) AS started_without_end,
    COUNT(*) FILTER (WHERE connections > 1) AS several_connection_sessions,
    COALESCE(MAX(connections), 0) AS max_connections_in_one_session,
    COUNT(*) FILTER (WHERE measured.session_id IS NOT NULL) AS matched_statistics,
    COUNT(*) FILTER (WHERE measured.session_id IS NULL) AS without_statistics
FROM sessions LEFT JOIN measured ON measured.session_id = sessions.session_id;
