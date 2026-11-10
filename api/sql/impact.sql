-- The dashboard only reads what the pipeline stored (pipeline/sql/job.sql).
-- Tags are whole-session. A session is included when it has events or stats on the selected days,
-- and only those days' streamed time counts. Sessions without any events are never counted as
-- sessions; they appear only under "Readings but no activity".
-- Every report takes the same filters: sessions must carry all of %(filters)s; when %(reason)s is set,
-- have exactly that reason; and when %(error_event)s is set, have an error on the selected days that
-- matches it on event, code, stage, phase, reason and after_end. Those conditions are written once,
-- in "selected" below, and every report puts them in its WHERE as {selected} (shared/db.py does that).

-- Not a report on its own: the filters every report below applies to session_analysis a.
-- report: selected
a.tags @> %(filters)s::STRING[] AND (%(reason)s = '' OR a.why = %(reason)s)
    AND (%(error_event)s = '' OR EXISTS (SELECT 1 FROM session_day_error_events x
        WHERE x.session_id = a.session_id AND x.day >= %(start)s::DATE AND x.day < %(end)s::DATE
            AND x.code = %(error_code)s AND x.event = %(error_event)s
            AND x.stage = %(error_stage)s AND x.phase = %(error_phase)s
            AND x.reason = %(error_reason)s AND x.after_end = (%(error_after_end)s = '1')))

-- report: impact_tags
-- Sessions per tag. The cards and the filter list both come from this one query.
WITH active AS (
    -- Sessions with events or readings on the selected days. Tags are whole-session, so the days
    -- only decide which sessions are in.
    SELECT DISTINCT session_id FROM session_day_analysis
    WHERE day >= %(start)s::DATE AND day < %(end)s::DATE
)
SELECT t.tag, COUNT(*) AS sessions
FROM active
JOIN session_analysis a ON a.session_id = active.session_id
-- One row per tag a session carries, so counting per tag is a plain GROUP BY.
CROSS JOIN LATERAL unnest(a.tags) AS t(tag)
-- Sessions with events only. Readings-only sessions are counted by impact_totals instead.
WHERE a.events > 0 AND {selected}
GROUP BY t.tag;

-- report: impact_totals
-- Session count, streamed time and frame rate of the selected days, plus the wait until video.
WITH days AS (
    -- Each session's numbers on the selected days only, added up across those days.
    SELECT session_id, SUM(events) AS events, SUM(batches) AS batches,
        SUM(streamed_seconds) AS streamed_seconds, SUM(low_fps_seconds) AS low_fps_seconds,
        SUM(fps_sum) AS fps_sum, SUM(fps_valid) AS fps_valid
    FROM session_day_analysis
    WHERE day >= %(start)s::DATE AND day < %(end)s::DATE
    GROUP BY session_id
), picked AS (
    -- counted: the session has events. The rest only sent readings and are reported as stats_only.
    -- The wait until video is whole-session, in seconds.
    SELECT days.*, a.events > 0 AS counted, a.first_ready_ms / 1000 AS ready_seconds
    FROM days JOIN session_analysis a ON a.session_id = days.session_id
    WHERE {selected}
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

-- report: impact_measures
-- For every measurement, the typical session and the slowest tenth of sessions, plus the plain
-- average of all readings. A few long sessions with huge spikes pull the plain average far from
-- what most players saw, so the cards lead with the typical session.
WITH active AS (
    -- Sessions with events or readings on the selected days.
    SELECT DISTINCT session_id FROM session_day_analysis
    WHERE day >= %(start)s::DATE AND day < %(end)s::DATE
), per_session AS (
    -- Each session's own average first, so a long session counts once, not once per reading.
    SELECT m.measure, m.session_id, SUM(m.total) AS total, SUM(m.readings) AS readings,
        SUM(m.total) / SUM(m.readings)::FLOAT8 AS session_average
    FROM session_day_measures m
    JOIN active ON active.session_id = m.session_id
    JOIN session_analysis a ON a.session_id = m.session_id
    WHERE m.day >= %(start)s::DATE AND m.day < %(end)s::DATE
        AND a.events > 0 AND {selected}
    GROUP BY m.measure, m.session_id
)
-- average: all readings pooled. typical: the middle session. high_tenth and low_tenth: the session
-- averages only a tenth of sessions are above or below. Whether high is bad depends on the
-- measurement (latency against FPS), so both are returned.
SELECT measure, SUM(total) / SUM(readings)::FLOAT8 AS average, SUM(readings)::INT8 AS readings,
    COUNT(*) AS sessions,
    percentile_disc(0.5) WITHIN GROUP (ORDER BY session_average) AS typical,
    percentile_disc(0.9) WITHIN GROUP (ORDER BY session_average) AS high_tenth,
    percentile_disc(0.1) WITHIN GROUP (ORDER BY session_average) AS low_tenth
FROM per_session
GROUP BY measure;

-- report: impact_trend
-- The headline numbers of each day on its own, for the small trend lines on the cards.
WITH days AS (
    -- One row per session and selected day. The wait until video is whole-session, so a session
    -- that crosses midnight brings the same wait to each of its days.
    SELECT d.day, d.streamed_seconds, d.low_fps_seconds, d.fps_sum, d.fps_valid, a.tags, a.first_ready_ms
    FROM session_day_analysis d
    JOIN session_analysis a ON a.session_id = d.session_id
    WHERE d.day >= %(start)s::DATE AND d.day < %(end)s::DATE
        AND a.events > 0 AND {selected}
)
SELECT day, COUNT(*) AS sessions,
    COUNT(*) FILTER (WHERE tags @> ARRAY['tried']) AS tried,
    COUNT(*) FILTER (WHERE tags @> ARRAY['no_success']) AS never_connected,
    COALESCE(SUM(streamed_seconds), 0)::INT8 AS streamed_seconds,
    COALESCE(SUM(low_fps_seconds), 0)::INT8 AS low_fps_seconds,
    -- No readings that day gives no average, rather than dividing by zero.
    SUM(fps_sum) / NULLIF(SUM(fps_valid), 0)::FLOAT8 AS fps_mean,
    percentile_disc(0.5) WITHIN GROUP (ORDER BY first_ready_ms / 1000) AS ready_p50
FROM days
GROUP BY day
ORDER BY day;

-- report: impact_error_events
-- Every error event, code, stage, phase and reason in the selected sessions, with how many
-- sessions had it, real errors first and retries of an already closed session after them.
WITH active AS (
    -- Sessions with events or readings on the selected days.
    SELECT DISTINCT session_id FROM session_day_analysis
    WHERE day >= %(start)s::DATE AND day < %(end)s::DATE
)
SELECT r.code, r.event, r.stage, r.phase, r.reason, r.after_end, COUNT(DISTINCT r.session_id) AS sessions,
    SUM(r.events)::INT8 AS events
FROM session_day_error_events r
JOIN active ON active.session_id = r.session_id
JOIN session_analysis a ON a.session_id = r.session_id
WHERE r.day >= %(start)s::DATE AND r.day < %(end)s::DATE
    AND a.events > 0 AND {selected}
GROUP BY r.code, r.event, r.stage, r.phase, r.reason, r.after_end
-- false sorts first, so real errors come before retries of a closed session, most sessions first.
ORDER BY r.after_end, sessions DESC, r.code, r.event, r.stage, r.phase, r.reason;

-- report: impact_list
-- One page of the sessions behind a card, the ones that matter most for that card first.
-- The page is picked first, so the main error is looked up for those 25 sessions only.
WITH active AS (
    -- Sessions with events or readings on the selected days.
    SELECT DISTINCT session_id FROM session_day_analysis
    WHERE day >= %(start)s::DATE AND day < %(end)s::DATE
), page AS (
    -- Only the columns the list shows, plus the two sort keys below.
    SELECT a.session_id, a.first_seen, a.attempts, a.batches, a.streamed_seconds, a.low_fps_seconds,
        a.high_skip_seconds, a.fps_mean, a.stream_drops, a.first_ready_ms, a.why,
        -- A column the user picked sorts first (empty values last); otherwise the card's own order.
        CASE %(sort)s
            WHEN 'first_seen' THEN EXTRACT(EPOCH FROM a.first_seen)::FLOAT8
            WHEN 'streamed' THEN a.streamed_seconds::FLOAT8
            WHEN 'fps' THEN a.fps_mean
            WHEN 'low_fps' THEN a.low_fps_seconds::FLOAT8
            WHEN 'attempts' THEN a.attempts::FLOAT8
            WHEN 'drops' THEN a.stream_drops::FLOAT8
            WHEN 'skipped' THEN a.high_skip_seconds::FLOAT8
            WHEN 'wait' THEN a.first_ready_ms
            -- Flipping the sign lets descending use ASC NULLS LAST, so empty values stay last both ways.
            END * (CASE WHEN %(descending)s THEN -1 ELSE 1 END)::FLOAT8 AS picked_order,
        -- The card's own order, worst first under DESC. FPS is negated so the lowest comes first.
        -- Every session on those two cards has a frame rate, so the 0 for a missing one never applies.
        CASE %(category)s
            WHEN 'low_fps' THEN -COALESCE(a.fps_mean, 0)
            WHEN 'fps' THEN -COALESCE(a.fps_mean, 0)
            WHEN 'any_low_fps' THEN a.low_fps_seconds::FLOAT8
            WHEN 'measured' THEN a.streamed_seconds::FLOAT8
            WHEN 'repeated_attempts' THEN a.attempts::FLOAT8
            WHEN 'ready' THEN a.first_ready_ms
            WHEN 'stream_drops' THEN a.stream_drops::FLOAT8
            WHEN 'high_skip' THEN a.high_skip_seconds::FLOAT8
            ELSE 0 END AS card_order
    FROM active
    JOIN session_analysis a ON a.session_id = active.session_id
    -- "Readings but no activity" is the one list of sessions without any events.
    WHERE (a.events = 0) = (%(category)s = 'stats_only')
        -- "all" and "stats_only" take every session the line above lets through; other cards need their tag.
        AND (%(category)s IN ('all', 'stats_only') OR a.tags @> ARRAY[%(category)s]::STRING[])
        AND {selected}
        -- An empty search matches every session; otherwise any part of the ID.
        AND strpos(a.session_id::STRING, %(search)s) > 0
    -- Newest first, then by ID, so ties keep one order and paging never skips or repeats a session.
    ORDER BY picked_order ASC NULLS LAST, card_order DESC, a.first_seen DESC, a.session_id DESC
    LIMIT %(limit)s OFFSET %(offset)s
)
SELECT page.session_id, page.first_seen, page.attempts, page.batches, page.streamed_seconds,
    page.low_fps_seconds, page.high_skip_seconds, page.fps_mean, page.stream_drops, page.first_ready_ms,
    page.why, top.event AS error_event, top.code AS error_code, top.stage AS error_stage,
    top.phase AS error_phase, top.reason AS error_reason, top.events AS error_events
FROM page
-- The session's most frequent error before it ended, over its whole life, as sent.
LEFT JOIN LATERAL (
    SELECT x.event, x.code, x.stage, x.phase, x.reason, SUM(x.events)::INT8 AS events
    FROM session_day_error_events x
    WHERE x.session_id = page.session_id AND NOT x.after_end
    GROUP BY 1, 2, 3, 4, 5
    -- Ties go to the alphabetically first error, so the same one is shown every time.
    ORDER BY events DESC, 1, 2, 3, 4, 5
    LIMIT 1
) top ON TRUE
-- A join does not keep the page's order, so it is applied again.
ORDER BY page.picked_order ASC NULLS LAST, page.card_order DESC, page.first_seen DESC, page.session_id DESC;

-- report: impact_reasons
-- Why the sessions behind a card stopped where they did, over the whole list.
-- Their sum is the list's total.
WITH active AS (
    -- Sessions with events or readings on the selected days.
    SELECT DISTINCT session_id FROM session_day_analysis
    WHERE day >= %(start)s::DATE AND day < %(end)s::DATE
)
SELECT a.why AS reason, COUNT(*) AS sessions
FROM active
JOIN session_analysis a ON a.session_id = active.session_id
-- These conditions must match impact_list's exactly: the list's total is the sum of these counts.
-- "Readings but no activity" is the one list of sessions without any events.
WHERE (a.events = 0) = (%(category)s = 'stats_only')
    AND (%(category)s IN ('all', 'stats_only') OR a.tags @> ARRAY[%(category)s]::STRING[])
    AND {selected}
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
    -- A stats batch counts from the day it started; last_seen uses its end.
    SELECT MIN(bucket_start)::DATE, MAX(bucket_start)::DATE, MAX(bucket_end)
    FROM session_telemetry_stats
) AS dates;

-- report: processed
-- When the pipeline last finished, and how far into each table it had read.
-- The row named sessions is the last finished run (see process_save_state).
SELECT finished_at, events_until, stats_until FROM processor_state WHERE name = 'sessions';
