-- The pipeline's queries: what it reads from raw telemetry for each batch of sessions, and
-- how it saves the results. Run by pipeline/job.py.
-- report: process_marks
-- Where the raw data ends right now. Read once at the start of a run and saved only when the run finishes.
-- An event stamped in the future is left out until its time comes. Otherwise it would move the
-- saved point ahead, so sessions arriving before that time would never be queued, and the page
-- would keep saying newer data has arrived when none has. An empty table gives no mark.
SELECT
    (SELECT MAX(recorded_at) FROM session_telemetry_events WHERE recorded_at <= now()) AS events_until,
    (SELECT MAX(created_at) FROM session_telemetry_stats) AS stats_until;

-- report: process_lock
-- Only one run at a time. A lock older than an hour belongs to a run that died, so it is taken over.
-- The token is the run's own, so only the run holding the lock can refresh or free it.
INSERT INTO processor_lock (name, started_at, token) VALUES ('sessions', now(), %(token)s)
ON CONFLICT (name) DO UPDATE SET started_at = now(), token = %(token)s
WHERE processor_lock.started_at < now() - INTERVAL '1 hour'
RETURNING name;

-- report: process_lock_refresh
-- Marks the lock as fresh, so a long run is never taken for one that died. No row back means
-- another run took the lock over.
UPDATE processor_lock SET started_at = now() WHERE name = 'sessions' AND token = %(token)s RETURNING name;

-- report: process_unlock
-- Frees the lock when a run ends, whether or not it succeeded, but only if this run still holds it.
DELETE FROM processor_lock WHERE name = 'sessions' AND token = %(token)s;

-- report: process_state
-- "sessions" is how far the last finished run read; "pending" is the run in progress.
SELECT events_until, stats_until, rules_version FROM processor_state WHERE name = %(name)s;

-- report: process_save_state
-- Saves how far a run read and which rules it used, under "sessions" or "pending".
UPSERT INTO processor_state (name, events_until, stats_until, rules_version, finished_at)
VALUES (%(name)s, %(events_until)s, %(stats_until)s, %(rules_version)s, now());

-- report: process_queue_changed
-- Queue the sessions with events or stats saved in the given time range.
-- Both filters use existing indexes (recorded_at on events, created_at on stats),
-- and the ids go straight into the queue table without passing through Python.
UPSERT INTO processor_queue (session_id)
SELECT session_id FROM session_telemetry_events
WHERE recorded_at >= %(events_since)s AND recorded_at <= %(events_until)s
UNION
SELECT session_id FROM session_telemetry_stats
WHERE created_at >= %(stats_since)s AND created_at <= %(stats_until)s;

-- report: process_queue_clear
-- Empties the queue, for --full. WHERE true spells out "every row", which CockroachDB's
-- safe-updates mode requires for a delete.
DELETE FROM processor_queue WHERE true;

-- report: process_next
-- The next batch of queued sessions, in a fixed order.
SELECT session_id FROM processor_queue ORDER BY session_id LIMIT %(batch)s;

-- report: process_dequeue
-- Takes a saved batch off the queue, in the same transaction as the save.
DELETE FROM processor_queue WHERE session_id = ANY(%(ids)s::UUID[]);

-- report: process_events
-- Event facts per session and UTC day, for one batch of sessions.
-- A failure after the session first ended is a stale reconnect to a released host,
-- not a user who could not connect.
WITH ends AS (
    -- When each session first ended. Its events from then on are marked after_end.
    SELECT session_id, MIN(recorded_at) AS ended_at
    FROM session_telemetry_events
    WHERE session_id = ANY(%(ids)s::UUID[]) AND event_type = 'session_ended'
    GROUP BY session_id
), events AS (
    SELECT e.recorded_at, e.recorded_at::DATE AS day, e.session_id, e.event_type, e.payload,
        e.payload->>'event' AS name, COALESCE(e.recorded_at >= ends.ended_at, FALSE) AS after_end
    FROM session_telemetry_events e LEFT JOIN ends ON ends.session_id = e.session_id
    WHERE e.session_id = ANY(%(ids)s::UUID[])
)
SELECT session_id, day, COUNT(*) AS events, MIN(recorded_at) AS first_seen,
    COUNT(*) FILTER (WHERE name = 'pipeline.connect.attempt') AS attempts,
    -- Real failures and stale ones are counted apart; only real ones make a session a failure.
    COUNT(*) FILTER (WHERE name = 'pipeline.connect.failure' AND NOT after_end) AS failures,
    COUNT(*) FILTER (WHERE name = 'pipeline.connect.failure' AND after_end) AS failures_after_end,
    MAX(recorded_at) FILTER (WHERE name = 'pipeline.connect.failure' AND NOT after_end) AS last_failure,
    MAX(recorded_at) FILTER (WHERE name = 'pipeline.connect.success') AS last_success,
    MIN(recorded_at) FILTER (WHERE name = 'pipeline.connect.success') AS first_success,
    -- Time to video sent with the day's first successful connect; empty when that success sent none.
    (array_agg(CASE WHEN jsonb_typeof(payload->'timeToReadyMs') = 'number'
            THEN (payload->>'timeToReadyMs')::FLOAT8 END ORDER BY recorded_at)
        FILTER (WHERE name = 'pipeline.connect.success'))[1] AS first_ready_ms,
    -- How far a session got, to explain why it never connected.
    COUNT(*) FILTER (WHERE event_type = 'host_connected') AS host_connects,
    COUNT(*) FILTER (WHERE event_type = 'client_connected') AS client_connects,
    COUNT(*) FILTER (WHERE name = 'webrtc.connection.state' AND payload->>'state' = 'failed')
        AS webrtc_failures,
    -- Connected, then lost the stream while playing.
    COUNT(*) FILTER (WHERE name = 'webrtc.connection.state' AND payload->>'prev' = 'connected'
        AND payload->>'state' IN ('disconnected', 'failed')) AS stream_drops,
    COUNT(*) FILTER (WHERE event_type = 'client_reconnected') AS reconnects,
    COUNT(*) FILTER (WHERE event_type = 'ws_error') AS channel_errors,
    COUNT(*) FILTER (WHERE name = 'ws.disconnect') AS channel_drops,
    COUNT(*) FILTER (WHERE name = 'ws.reconnect.success') AS channel_recoveries,
    COUNT(*) FILTER (WHERE name = 'ice.restart') AS route_restarts,
    COUNT(*) FILTER (WHERE name = 'session.recreate') AS recreations,
    COUNT(*) FILTER (WHERE event_type = 'session_ended') AS ends,
    -- How it ended. Only these three fixed values are read.
    COUNT(*) FILTER (WHERE payload->>'end_reason' = 'Device deleted') AS device_deleted_ends,
    COUNT(*) FILTER (WHERE payload->>'end_reason' = 'Not in use') AS not_in_use_ends,
    COUNT(*) FILTER (WHERE payload->>'end_reason' = 'Ended by user') AS user_ends,
    -- Who joined. Only these fixed values are read; free-text fields such as messages never are.
    COUNT(*) FILTER (WHERE payload->>'mode' = 'owner') AS owner_joins,
    COUNT(*) FILTER (WHERE payload->>'mode' = 'share') AS share_joins,
    COUNT(*) FILTER (WHERE payload->>'mode' IN ('external', 'external_session')) AS external_joins,
    -- Code, stage and phase of the day's last real failure. The reason text is never read.
    (array_agg(COALESCE(payload->>'code', '') || ' / ' || COALESCE(payload->>'stage', '') || ' / '
            || COALESCE(payload->>'phase', '')
        ORDER BY recorded_at DESC)
        FILTER (WHERE name = 'pipeline.connect.failure' AND NOT after_end))[1] AS failure_detail
FROM events
GROUP BY session_id, day;

-- report: process_errors
-- Which kinds of error each session had, and which part of the app each came from.
-- Errors after the session first ended are stale retries, left out as for failures.
-- A connection state event is an error type only when its state is "failed", as its title says.
-- Only the event name, state and stage are read, never the message.
WITH ends AS (
    SELECT session_id, MIN(recorded_at) AS ended_at
    FROM session_telemetry_events
    WHERE session_id = ANY(%(ids)s::UUID[]) AND event_type = 'session_ended'
    GROUP BY session_id
)
SELECT e.session_id, e.recorded_at::DATE AS day,
    array_agg(DISTINCT e.payload->>'event') FILTER (WHERE e.payload->>'event' IS NOT NULL
        AND (e.payload->>'event' NOT IN ('webrtc.connection.state', 'ice.connection.state')
            OR e.payload->>'state' = 'failed')) AS error_types,
    array_agg(DISTINCT e.payload->>'stage') FILTER (WHERE e.payload->>'stage' IS NOT NULL) AS error_stages
FROM session_telemetry_events e LEFT JOIN ends ON ends.session_id = e.session_id
WHERE e.session_id = ANY(%(ids)s::UUID[]) AND e.level = 'error'
    -- Sessions with no end keep every error.
    AND (ends.ended_at IS NULL OR e.recorded_at < ends.ended_at)
GROUP BY e.session_id, e.recorded_at::DATE;

-- report: process_batches
-- A statistics batch belongs to the UTC day it started.
SELECT session_id, bucket_start::DATE AS day, COUNT(*) AS batches
FROM session_telemetry_stats
WHERE session_id = ANY(%(ids)s::UUID[])
GROUP BY session_id, bucket_start::DATE;

-- report: process_seconds
-- Each batch holds readings one second apart; "ts" is epoch milliseconds.
-- Counting distinct seconds per session gives streamed time without adding up
-- connections that were live at the same moment. A second belongs to its own UTC day.
WITH readings AS (
    SELECT s.session_id,
        -- One row per reading: i walks the positions of the ts array, and the same position in fps
        -- and skippedFrames belongs to that moment. Dividing by 1000 and rounding down turns
        -- milliseconds into whole seconds; a time with decimals or out of range can't fail the batch.
        CASE WHEN jsonb_typeof(s.samples->'ts'->i) = 'number'
                AND (s.samples->'ts'->>i)::FLOAT8 BETWEEN 0 AND 1e15
            THEN floor((s.samples->'ts'->>i)::FLOAT8 / 1000)::INT8 END AS second,
        CASE WHEN jsonb_typeof(s.samples->'fps'->i) = 'number'
            THEN (s.samples->'fps'->>i)::FLOAT8 END AS fps,
        CASE WHEN jsonb_typeof(s.samples->'skippedFrames'->i) = 'number'
            THEN (s.samples->'skippedFrames'->>i)::FLOAT8 END AS skipped
    FROM session_telemetry_stats s
    -- The length is only asked of a real array; anything else gives no readings instead of
    -- failing the batch, since the WHERE below may run after this.
    CROSS JOIN LATERAL generate_series(0, CASE WHEN jsonb_typeof(s.samples->'ts') = 'array'
        THEN jsonb_array_length(s.samples->'ts') ELSE 0 END - 1) AS i
    WHERE s.session_id = ANY(%(ids)s::UUID[]) AND jsonb_typeof(s.samples->'ts') = 'array'
), per_second AS (
    -- 30 FPS is the idle rate, so a second is low only when some connection was under it.
    SELECT session_id, second,
        -- Negative values are not readings, so they never make a second low.
        BOOL_OR(fps < %(low_fps)s) FILTER (WHERE fps >= 0) AS low,
        BOOL_OR(skipped >= %(high_skip)s) AS high_skip,
        -- Only finite readings of 0 or more go into the average.
        SUM(fps) FILTER (WHERE fps >= 0 AND fps < 'Infinity'::FLOAT8) AS fps_sum,
        COUNT(fps) FILTER (WHERE fps >= 0 AND fps < 'Infinity'::FLOAT8) AS fps_valid
    FROM readings
    WHERE second IS NOT NULL
    GROUP BY session_id, second
)
SELECT session_id, to_timestamp(second::FLOAT8)::DATE AS day, COUNT(*) AS streamed_seconds,
    COUNT(*) FILTER (WHERE low) AS low_fps_seconds,
    COUNT(*) FILTER (WHERE high_skip) AS high_skip_seconds,
    COALESCE(SUM(fps_sum), 0)::FLOAT8 AS fps_sum, COALESCE(SUM(fps_valid), 0)::INT8 AS fps_valid
FROM per_second
GROUP BY session_id, to_timestamp(second::FLOAT8)::DATE;

-- report: process_error_events
-- Every error event with its code, stage, phase and the app's own text, unchanged. An error is an
-- event with level 'error', the one rule used everywhere; codes are only ever sent on those. Connection
-- errors send "code" and "reason"; network path errors send "errorCode" and "errorText";
-- connection state errors send "prev" and "state", kept as "prev → state"; errors with none of
-- these keep their own message. Errors after the session first ended are kept but marked, so
-- the page can show them apart from real errors.
WITH ends AS (
    SELECT session_id, MIN(recorded_at) AS ended_at
    FROM session_telemetry_events
    WHERE session_id = ANY(%(ids)s::UUID[]) AND event_type = 'session_ended'
    GROUP BY session_id
)
SELECT e.session_id, e.recorded_at::DATE AS day,
    -- An event sent without a name in its payload uses its event type instead.
    COALESCE(e.payload->>'event', e.event_type::STRING) AS event,
    COALESCE(e.payload->>'code', e.payload->>'errorCode', '') AS code,
    COALESCE(e.payload->>'stage', '') AS stage, COALESCE(e.payload->>'phase', '') AS phase,
    COALESCE(e.payload->>'reason', e.payload->>'errorText',
        CASE WHEN e.payload ? 'state' THEN COALESCE(e.payload->>'prev', '?') || ' → ' || (e.payload->>'state') END,
        NULLIF(e.message, COALESCE(e.payload->>'event', e.event_type::STRING)), '') AS reason,
    COALESCE(e.recorded_at >= ends.ended_at, FALSE) AS after_end, COUNT(*) AS events
FROM session_telemetry_events e LEFT JOIN ends ON ends.session_id = e.session_id
WHERE e.session_id = ANY(%(ids)s::UUID[]) AND e.level = 'error'
-- The same error on the same day is one row, with how many times it was sent.
GROUP BY 1, 2, 3, 4, 5, 6, 7, 8;

-- report: process_clear_error_events
-- Removes a batch's stored errors before they are saved again.
DELETE FROM session_day_error_events WHERE session_id = ANY(%(ids)s::UUID[]);

-- report: process_save_error_event
-- One row of process_error_events, saved as read.
INSERT INTO session_day_error_events (day, session_id, event, code, stage, phase, reason, after_end, events)
VALUES (%(day)s, %(session_id)s, %(event)s, %(code)s, %(stage)s, %(phase)s, %(reason)s, %(after_end)s,
    %(events)s);

-- report: process_measures
-- Sum and count of every valid reading of each known measurement, per session and UTC day.
-- A reading belongs to the day of its own timestamp, like streamed seconds.
-- Each value is cast once, and only when it is a number, so one odd value can never stop the job.
SELECT session_id, to_timestamp(second::FLOAT8)::DATE AS day, measure, SUM(amount) AS total,
    COUNT(*) AS readings
FROM (
    SELECT s.session_id, m.key AS measure,
        CASE WHEN jsonb_typeof(s.samples->'ts'->i) = 'number'
                AND (s.samples->'ts'->>i)::FLOAT8 BETWEEN 0 AND 1e15
            THEN floor((s.samples->'ts'->>i)::FLOAT8 / 1000)::INT8 END AS second,
        CASE WHEN jsonb_typeof(m.value->i) = 'number' THEN (m.value->>i)::FLOAT8 END AS amount
    FROM session_telemetry_stats s
    -- Only a real object is unpacked and only a real array is measured, so a malformed batch gives
    -- no readings instead of failing the batch, as session_metrics in api/sql/sessions.sql does.
    CROSS JOIN LATERAL jsonb_each(
        CASE WHEN jsonb_typeof(s.samples) = 'object' THEN s.samples ELSE '{}'::JSONB END) AS m(key, value)
    CROSS JOIN LATERAL generate_series(0, CASE WHEN jsonb_typeof(s.samples->'ts') = 'array'
        THEN jsonb_array_length(s.samples->'ts') ELSE 0 END - 1) AS i
    WHERE s.session_id = ANY(%(ids)s::UUID[]) AND jsonb_typeof(s.samples->'ts') = 'array'
        -- Only these known measurements, so an unexpected key never becomes a row.
        AND m.key IN ('fps', 'latency', 'jitter', 'bitrate', 'downloadSpeed', 'decodeDuration',
            'encodeDuration', 'skippedFrames', 'accumulatedFrames')
        AND jsonb_typeof(m.value) = 'array'
) readings
WHERE second IS NOT NULL AND amount >= 0 AND amount < 'Infinity'::FLOAT8
GROUP BY 1, 2, 3;

-- report: process_clear_measures
-- Removes a batch's stored measurements before they are saved again.
DELETE FROM session_day_measures WHERE session_id = ANY(%(ids)s::UUID[]);

-- report: process_save_measure
-- One row of process_measures, saved as read.
INSERT INTO session_day_measures (day, session_id, measure, total, readings)
VALUES (%(day)s, %(session_id)s, %(measure)s, %(total)s, %(readings)s);

-- report: process_clear_days
-- A batch replaces everything stored for its sessions, so a rerun never doubles a number.
DELETE FROM session_day_analysis WHERE session_id = ANY(%(ids)s::UUID[]);

-- report: process_clear_sessions
-- Removes a batch's session rows before they are saved again.
DELETE FROM session_analysis WHERE session_id = ANY(%(ids)s::UUID[]);

-- report: process_save_day
-- One session's numbers for one UTC day.
INSERT INTO session_day_analysis (day, session_id, events, batches, streamed_seconds, low_fps_seconds,
    high_skip_seconds, fps_sum, fps_valid)
VALUES (%(day)s, %(session_id)s, %(events)s, %(batches)s, %(streamed_seconds)s, %(low_fps_seconds)s,
    %(high_skip_seconds)s, %(fps_sum)s, %(fps_valid)s);

-- report: process_save_session
-- One session's whole-life facts, its tags and its reason line.
INSERT INTO session_analysis (session_id, first_seen, events, attempts, failures, failures_after_end,
    last_failure, last_success, first_success, first_ready_ms, failure_detail, host_connects,
    client_connects, webrtc_failures, stream_drops, reconnects, channel_errors, ends, owner_joins,
    share_joins, external_joins, batches, streamed_seconds, low_fps_seconds, high_skip_seconds, fps_sum,
    fps_valid, fps_mean, why, tags, rules_version, processed_at)
VALUES (%(session_id)s, %(first_seen)s, %(events)s, %(attempts)s, %(failures)s, %(failures_after_end)s,
    %(last_failure)s, %(last_success)s, %(first_success)s, %(first_ready_ms)s, %(failure_detail)s,
    %(host_connects)s, %(client_connects)s, %(webrtc_failures)s, %(stream_drops)s, %(reconnects)s,
    %(channel_errors)s, %(ends)s, %(owner_joins)s, %(share_joins)s, %(external_joins)s, %(batches)s,
    %(streamed_seconds)s, %(low_fps_seconds)s, %(high_skip_seconds)s, %(fps_sum)s, %(fps_valid)s,
    %(fps_mean)s, %(why)s, %(tags)s, %(rules_version)s, now());
