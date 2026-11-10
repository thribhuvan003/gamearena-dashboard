-- Run once on the telemetry database when deploying the API.
-- Only the range report (first and last dates) uses this index now: the other reports read stats
-- by session. It lets range find those dates without reading the large measurement JSON.
-- STORING copies session_id and bucket_end into the index, so range can answer from the index alone.
CREATE INDEX IF NOT EXISTS telemetry_stats_bucket_start
ON session_telemetry_stats (bucket_start) STORING (session_id, bucket_end);
