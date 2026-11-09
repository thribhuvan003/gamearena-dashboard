-- The dashboard only reads what the processor stored (database/processor.sql).
-- Tags are whole-session. A session is included when it has events or stats on the selected days,
-- and only those days' streamed time counts. Sessions without any events are never counted as
-- sessions; they appear only under "Stats but no activity".
-- Every report takes the same filters: sessions must carry all of %(filters)s,
-- and, when %(reason)s is set, have exactly that reason.

-- report: impact_tags
-- Sessions per tag. The cards and the filter list both come from this one query.
WITH active AS (
    SELECT DISTINCT session_id FROM session_day_analysis
    WHERE day >= %(start)s::DATE AND day < %(end)s::DATE
)
SELECT t.tag, COUNT(*) AS sessions
FROM active
JOIN session_analysis a ON a.session_id = active.session_id
CROSS JOIN LATERAL unnest(a.tags) AS t(tag)
WHERE a.events > 0 AND a.tags @> %(filters)s::STRING[] AND (%(reason)s = '' OR a.why = %(reason)s)
GROUP BY t.tag;

-- report: impact_totals
-- Session count, streamed time and frame rate of the selected days, plus the wait until video.
WITH days AS (
    SELECT session_id, SUM(events) AS events, SUM(batches) AS batches,
        SUM(streamed_seconds) AS streamed_seconds, SUM(low_fps_seconds) AS low_fps_seconds,
        SUM(fps_sum) AS fps_sum, SUM(fps_valid) AS fps_valid
    FROM session_day_analysis
    WHERE day >= %(start)s::DATE AND day < %(end)s::DATE
    GROUP BY session_id
), picked AS (
    SELECT days.*, a.events > 0 AS counted, a.first_ready_ms / 1000 AS ready_seconds
    FROM days JOIN session_analysis a ON a.session_id = days.session_id
    WHERE a.tags @> %(filters)s::STRING[] AND (%(reason)s = '' OR a.why = %(reason)s)
)
SELECT COUNT(*) FILTER (WHERE counted) AS sessions,
    COUNT(*) FILTER (WHERE NOT counted) AS stats_only,
    COALESCE(SUM(streamed_seconds) FILTER (WHERE counted), 0)::INT8 AS streamed_seconds,
    COALESCE(SUM(low_fps_seconds) FILTER (WHERE counted), 0)::INT8 AS low_fps_seconds,
    COALESCE(SUM(fps_sum) FILTER (WHERE counted), 0)::FLOAT8 AS fps_sum,
    COALESCE(SUM(fps_valid) FILTER (WHERE counted), 0)::INT8 AS fps_valid,
    -- Nearest rank: always a wait that really happened, never an interpolated one.
    (SELECT percentile_disc(0.5) WITHIN GROUP (ORDER BY ready_seconds) FROM picked
        WHERE counted AND ready_seconds IS NOT NULL) AS ready_p50,
    (SELECT percentile_disc(0.9) WITHIN GROUP (ORDER BY ready_seconds) FROM picked
        WHERE counted AND ready_seconds IS NOT NULL) AS ready_p90
FROM picked;

-- report: impact_list
-- One page of the sessions behind a card, the ones that matter most for that card first.
WITH active AS (
    SELECT DISTINCT session_id FROM session_day_analysis
    WHERE day >= %(start)s::DATE AND day < %(end)s::DATE
)
SELECT a.session_id, a.first_seen, a.attempts, a.batches, a.streamed_seconds, a.low_fps_seconds,
    a.high_skip_seconds, a.fps_mean, a.stream_drops, a.first_ready_ms, a.why
FROM active
JOIN session_analysis a ON a.session_id = active.session_id
-- "Stats but no activity" is the one list of sessions without any events.
WHERE (a.events = 0) = (%(category)s = 'stats_only')
    AND (%(category)s IN ('all', 'stats_only') OR a.tags @> ARRAY[%(category)s]::STRING[])
    AND a.tags @> %(filters)s::STRING[] AND (%(reason)s = '' OR a.why = %(reason)s)
    AND strpos(a.session_id::STRING, %(search)s) > 0
ORDER BY CASE %(category)s
        WHEN 'low_fps' THEN -COALESCE(a.fps_mean, 0)
        WHEN 'fps' THEN -COALESCE(a.fps_mean, 0)
        WHEN 'any_low_fps' THEN a.low_fps_seconds::FLOAT8
        WHEN 'measured' THEN a.streamed_seconds::FLOAT8
        WHEN 'repeated_attempts' THEN a.attempts::FLOAT8
        WHEN 'ready' THEN a.first_ready_ms
        WHEN 'stream_drops' THEN a.stream_drops::FLOAT8
        WHEN 'high_skip' THEN a.high_skip_seconds::FLOAT8
        ELSE 0 END DESC,
    a.first_seen DESC, a.session_id DESC
LIMIT %(limit)s OFFSET %(offset)s;

-- report: impact_reasons
-- Why the sessions behind a card stopped where they did, over the whole list.
-- Their sum is the list's total.
WITH active AS (
    SELECT DISTINCT session_id FROM session_day_analysis
    WHERE day >= %(start)s::DATE AND day < %(end)s::DATE
)
SELECT a.why AS reason, COUNT(*) AS sessions
FROM active
JOIN session_analysis a ON a.session_id = active.session_id
-- "Stats but no activity" is the one list of sessions without any events.
WHERE (a.events = 0) = (%(category)s = 'stats_only')
    AND (%(category)s IN ('all', 'stats_only') OR a.tags @> ARRAY[%(category)s]::STRING[])
    AND a.tags @> %(filters)s::STRING[] AND (%(reason)s = '' OR a.why = %(reason)s)
    AND strpos(a.session_id::STRING, %(search)s) > 0
GROUP BY a.why
ORDER BY sessions DESC, reason;

-- report: range
-- First and last recorded dates in either table.
-- last_seen tells the page where the latest day's data stops.
SELECT MIN(first_day) AS start, MAX(last_day) AS end, MAX(last_seen) AS last_seen FROM (
    SELECT MIN(recorded_at)::DATE AS first_day, MAX(recorded_at)::DATE AS last_day,
        MAX(recorded_at) AS last_seen
    FROM session_telemetry_events
    UNION ALL
    SELECT MIN(bucket_start)::DATE, MAX(bucket_start)::DATE, MAX(bucket_end)
    FROM session_telemetry_stats
) AS dates;

-- report: processed
-- When the processor last finished, and how far into each table it had read.
SELECT finished_at, events_until, stats_until FROM processor_state WHERE name = 'sessions';
