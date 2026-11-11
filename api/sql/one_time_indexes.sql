-- Run once on the telemetry database when deploying the API.
-- Only the range report (first and last dates) uses this index now: the other reports read stats
-- by session. It lets range find those dates without reading the large measurement JSON.
-- STORING copies session_id and bucket_end into the index, so range can answer from the index alone.
CREATE INDEX IF NOT EXISTS telemetry_stats_bucket_start
ON session_telemetry_stats (bucket_start) STORING (session_id, bucket_end);

-- range also needs the latest bucket_end (last_seen). The index above stores bucket_end but is not
-- sorted by it, so MAX(bucket_end) read every row of it on each page load. Sorted by bucket_end, the
-- latest one is the index's last entry: a 1-row read.
CREATE INDEX IF NOT EXISTS session_telemetry_stats_bucket_end ON session_telemetry_stats (bucket_end);
