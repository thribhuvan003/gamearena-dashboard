-- report: issue_counts
-- Shared session predicates keep group totals aligned with their drill-down lists.
WITH sessions AS ({session_rows}) SELECT {issue_counts} FROM sessions;

-- report: issue_codes
-- Codes group recorded errors; messages, URLs and arbitrary payloads are not exposed.
SELECT LEFT(COALESCE(NULLIF(payload->>'errorCode',''), payload->>'code'), 100) AS error_code,
    COUNT(*) AS events, COUNT(DISTINCT session_id) AS sessions
FROM session_telemetry_events
WHERE recorded_at >= %(start)s AND recorded_at < %(end)s
    AND (level = 'error' OR event_type = 'ws_error' OR payload->>'event' = 'pipeline.connect.failure')
    AND COALESCE(NULLIF(payload->>'errorCode',''), NULLIF(payload->>'code','')) IS NOT NULL
GROUP BY 1 ORDER BY sessions DESC, events DESC, error_code;

-- report: fps_issue_sessions
-- The same predicate supports the card count and its affected-session list.
SELECT stats.session_id FROM session_telemetry_stats stats
CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(samples->'fps') = 'array' THEN samples->'fps' ELSE '[]'::JSONB END
) item(value)
WHERE bucket_start >= %(start)s AND bucket_start < %(end)s
    AND CASE WHEN jsonb_typeof(item.value) = 'number' THEN
        item.value::STRING::FLOAT8 >= 0 AND item.value::STRING::FLOAT8 < %(fps_threshold)s ELSE FALSE END
    AND EXISTS (SELECT 1 FROM session_telemetry_events e WHERE e.session_id = stats.session_id
        AND recorded_at >= %(start)s AND recorded_at < %(end)s)
GROUP BY stats.session_id;

-- report: fps_issue_count
SELECT COUNT(*) AS sessions FROM ({fps_issue_sessions}) affected;
