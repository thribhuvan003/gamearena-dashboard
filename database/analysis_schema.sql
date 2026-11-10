-- Tables written only by the processor (python -m processor). The raw telemetry tables are never changed.
-- The processor runs this file on every start, so each statement must be safe to repeat.

-- One row per session: whole-session facts, the tags every card and filter reads, and the reason text.
CREATE TABLE IF NOT EXISTS session_analysis (
    session_id UUID PRIMARY KEY,
    first_seen TIMESTAMPTZ,
    events INT8 NOT NULL,
    attempts INT8 NOT NULL,
    failures INT8 NOT NULL,
    failures_after_end INT8 NOT NULL,
    last_failure TIMESTAMPTZ,
    last_success TIMESTAMPTZ,
    first_success TIMESTAMPTZ,
    first_ready_ms FLOAT8,
    failure_detail STRING,
    host_connects INT8 NOT NULL,
    client_connects INT8 NOT NULL,
    webrtc_failures INT8 NOT NULL,
    stream_drops INT8 NOT NULL,
    reconnects INT8 NOT NULL,
    channel_errors INT8 NOT NULL,
    ends INT8 NOT NULL,
    owner_joins INT8 NOT NULL,
    share_joins INT8 NOT NULL,
    external_joins INT8 NOT NULL,
    batches INT8 NOT NULL,
    streamed_seconds INT8 NOT NULL,
    low_fps_seconds INT8 NOT NULL,
    high_skip_seconds INT8 NOT NULL,
    fps_sum FLOAT8 NOT NULL,
    fps_valid INT8 NOT NULL,
    fps_mean FLOAT8,
    why STRING NOT NULL,
    tags STRING[] NOT NULL,
    rules_version STRING NOT NULL,
    processed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    INVERTED INDEX session_analysis_tags (tags)
);

-- One row per session and UTC day. The date picker selects sessions here,
-- and time-based cards (streamed hours, average FPS) add these up.
-- The day comes first in the key, so a date range is one index scan.
CREATE TABLE IF NOT EXISTS session_day_analysis (
    day DATE NOT NULL,
    session_id UUID NOT NULL,
    events INT8 NOT NULL,
    batches INT8 NOT NULL,
    streamed_seconds INT8 NOT NULL,
    low_fps_seconds INT8 NOT NULL,
    high_skip_seconds INT8 NOT NULL,
    fps_sum FLOAT8 NOT NULL,
    fps_valid INT8 NOT NULL,
    PRIMARY KEY (day, session_id),
    INDEX session_day_analysis_session (session_id)
);

-- Sum and count of every valid per-second reading, per session, UTC day and measurement,
-- so the dashboard can average any measurement over any dates without reading raw stats.
CREATE TABLE IF NOT EXISTS session_day_measures (
    day DATE NOT NULL,
    session_id UUID NOT NULL,
    measure STRING NOT NULL,
    total FLOAT8 NOT NULL,
    readings INT8 NOT NULL,
    PRIMARY KEY (day, session_id, measure),
    INDEX session_day_measures_session (session_id)
);

-- Every error code with the reason the app gave, per session and UTC day, as sent and unchanged,
-- and whether it came after the session had already ended (a retry of a closed session).
DROP TABLE IF EXISTS session_day_errors;
CREATE TABLE IF NOT EXISTS session_day_error_reasons (
    day DATE NOT NULL,
    session_id UUID NOT NULL,
    event STRING NOT NULL,
    code STRING NOT NULL,
    reason STRING NOT NULL,
    after_end BOOL NOT NULL,
    events INT8 NOT NULL,
    PRIMARY KEY (day, session_id, event, code, reason, after_end),
    INDEX session_day_error_reasons_session (session_id)
);

-- How far the processor has read, so the next run only looks at new data.
CREATE TABLE IF NOT EXISTS processor_state (
    name STRING PRIMARY KEY,
    events_until TIMESTAMPTZ,
    stats_until TIMESTAMPTZ,
    finished_at TIMESTAMPTZ
);

-- The rules a finished run used. When they change, the next run retags every session.
ALTER TABLE processor_state ADD COLUMN IF NOT EXISTS rules_version STRING;

-- Sessions still to tag in the current run. Kept in the database, not in memory,
-- so a run of any size uses the same memory and a stopped run carries on where it was.
CREATE TABLE IF NOT EXISTS processor_queue (
    session_id UUID PRIMARY KEY
);

-- Only one run at a time.
CREATE TABLE IF NOT EXISTS processor_lock (
    name STRING PRIMARY KEY,
    started_at TIMESTAMPTZ NOT NULL
);
