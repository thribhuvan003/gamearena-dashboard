# Questions for the telemetry team

- What starts and stops `timeToReadyMs`? Until that is confirmed, it measures reported readiness rather than the entire wait to play.
- What units and time intervals do latency, jitter, bitrate and encoding/decoding measurements use?
- Are skipped and accumulated frame counts per interval or running totals? Adding running totals would overcount frames.
- Which disconnects are normal exits, and when should a reconnect indicate a product issue?

These answers determine which comparisons and thresholds are safe to use. The dashboard leaves unknown units and causes unclassified.
