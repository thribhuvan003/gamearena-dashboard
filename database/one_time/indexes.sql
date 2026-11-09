-- Run once on the telemetry database when deploying the backend.
-- Date selection can use this narrow index without copying the large measurement JSON.
CREATE INDEX IF NOT EXISTS telemetry_stats_bucket_start
ON session_telemetry_stats (bucket_start) STORING (session_id, bucket_end);
