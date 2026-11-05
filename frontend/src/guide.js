// Describe the schema without showing actual identifiers, messages or payload values.
export const fields = {
  Events: [
    [
      "id",
      "Event ID",
      "Identifies one recorded event; it is not a session count.",
    ],
    [
      "session_id",
      "Session ID",
      "Groups events belonging to the same session. We count distinct values, without displaying the IDs.",
    ],
    [
      "connection_id",
      "Connection ID",
      "Identifies a connection within a session. A session can have several connections; some events have no connection ID.",
    ],
    [
      "connection_role",
      "Connection role",
      "Shows whether the connection belongs to the host or client, when recorded.",
    ],
    [
      "source",
      "Event source",
      "The component that recorded the event, such as the client, host or system.",
    ],
    [
      "event_type",
      "Event type",
      "A broad action such as connection, disconnection, reconnection or a custom event.",
    ],
    [
      "level",
      "Log level",
      "How the producer classified the message: information, warning or error. An error is not proof the whole session failed.",
    ],
    [
      "message",
      "Message",
      "Detailed diagnostic text. It stays out of this dashboard because it can contain private information.",
    ],
    [
      "payload",
      "Payload",
      "Extra JSON fields. Event and category identify the action; phase and stage show where it happened. Fields vary by event.",
    ],
    [
      "recorded_at",
      "Event time",
      "The UTC timestamp used to filter and group events by day.",
    ],
  ],
  Statistics: [
    [
      "id",
      "Statistics record ID",
      "Identifies one stored batch of measurements.",
    ],
    ["session_id", "Session ID", "Links the measurement batch to its session."],
    [
      "connection_id",
      "Connection ID",
      "Links measurements to a connection when the value was recorded.",
    ],
    [
      "connection_role",
      "Connection role",
      "Describes which side of the connection the measurements refer to.",
    ],
    [
      "source",
      "Measurement source",
      "The component that collected the measurements.",
    ],
    [
      "bucket_start",
      "Batch start",
      "The start of the measurement batch; this dashboard uses it to select statistics by date.",
    ],
    [
      "bucket_end",
      "Batch end",
      "The end of the measurement batch. It does not establish the session end time.",
    ],
    [
      "sample_count",
      "Expected samples",
      "The expected number of timestamp entries in the batch.",
    ],
    [
      "samples",
      "Measurements",
      "JSON arrays such as timestamps, FPS, latency, jitter and bitrate. Empty or null entries are missing data, not zero.",
    ],
    [
      "created_at",
      "Storage time",
      "When the batch was saved; it can differ from when measurements were taken.",
    ],
  ],
  "Payload fields": [
    [
      "event",
      "Specific action",
      "Names the action within a custom event, such as a pipeline connection attempt or success.",
    ],
    [
      "category",
      "Technical area",
      "Groups custom events by area, such as pipeline, WebSocket, ICE or media.",
    ],
    [
      "phase",
      "Connection phase",
      "The broad part of the lifecycle where the event was logged.",
    ],
    [
      "stage",
      "Processing stage",
      "The component or step being handled when the event was logged. It is not a root-cause verdict.",
    ],
    [
      "attempt",
      "Producer retry number",
      "An optional retry number. The dashboard counts repeated pipeline attempt events separately rather than assuming every event supplies this field.",
    ],
    [
      "timeToReadyMs",
      "Producer readiness timing",
      "An optional readiness duration supplied by the producer. Its exact start and finish need confirmation before comparing sessions.",
    ],
    [
      "errorCode",
      "Diagnostic code",
      "An optional error identifier. A code alone does not prove that the session never connected.",
    ],
    [
      "reason",
      "Diagnostic explanation",
      "Optional diagnostic text. Its raw contents stay out of the dashboard because they may contain private information.",
    ],
  ],
};

// Keep table explanations in one place so the same word always has the same meaning.
export const columnHelp = {
  Date: "The UTC calendar day when the events were recorded.",
  "Observed sessions":
    "Distinct session IDs with at least one event on this day. Each ID is counted once, regardless of how many events it produced.",
  "With success":
    "Distinct sessions with at least one pipeline connection success event on this day. A session may also have a failure event.",
  "With failure":
    "Distinct sessions with at least one pipeline connection failure event on this day. A later success is still possible.",
  "Recorded outcome":
    "The combination of connection success and failure events found for a session inside the selected dates.",
  Sessions:
    "Distinct session IDs associated with this row. Repeated matching events from the same session count once in this row.",
  "Phase and stage":
    "Phase is the broad connection lifecycle step; stage is the component handling it. Not recorded / other groups missing or unrecognised labels.",
  "Failure events":
    "Number of pipeline.connect.failure records. Repeated failures in one session each count as another event; this is not a count of permanently failed sessions or unique connections.",
  Month: "The calendar month, using only the days inside the selected range.",
  "Average FPS":
    "Sum of valid frame-rate samples divided by their sample count, in frames per second.",
  "Average latency":
    "Mean of valid recorded latency samples. The producer must confirm the unit and exactly what delay is measured.",
  "Average jitter":
    "Mean of valid recorded jitter samples. The producer must confirm the unit and exactly what variation is measured.",
  "FPS samples":
    "Number of valid numeric frame-rate readings used in that month's average. This is not the number of sessions or frames.",
  "Field and meaning":
    "The original measurement name and its plain-language explanation. Unconfirmed producer definitions are marked explicitly.",
  "Array batches":
    "Statistics records containing an array for this field. A batch is one saved group of readings, not one session.",
  "Numeric samples":
    "Finite, non-negative numeric readings used in the calculation. Zero is included; missing and invalid values are excluded.",
  Average:
    "Sum of the valid readings divided by their count. Every reading has equal weight, so sessions with more readings contribute more.",
  "Minimum / maximum":
    "The smallest and largest valid reading in the selected period, in the field's recorded units.",
  "Null / invalid":
    "First number: explicitly missing array entries. Second: entries rejected because they are not valid non-negative, finite numbers. Neither is replaced with zero.",
  Topic: "The product behavior or logging question being investigated.",
  "Recorded evidence":
    "Counts calculated from the selected dates. Events count every matching record; sessions count each matching session ID once.",
  "What to check next":
    "A suggested investigation based on the evidence. It is not a confirmed explanation or root cause.",
  Measure: "The summary being calculated from the reported readiness values.",
  "Recorded value":
    "Numeric records is a count; median, 95th percentile and average are readiness durations in milliseconds, as indicated by timeToReadyMs.",
  Meaning: "How to interpret the value and which records were included.",
  "Field and purpose":
    "An optional payload field and the question it can help investigate. A payload is extra structured information attached to an event.",
  Occurrences:
    "Event records containing this payload field, including a field with a null value. Presence alone does not establish a usable measurement or failure.",
  Column:
    "The original database column or payload field name used by the telemetry producer.",
  "Plain meaning": "A short everyday name for that stored field.",
  "How to read it":
    "What the field represents, how the dashboard uses it, and any important limitation.",
};

// Explain the four mutually exclusive rows where founders see the outcome totals.
export const outcomeHelp = {
  "Success, no failure recorded":
    "At least one success event and no failure event within the selected dates.",
  "Both success and failure":
    "At least one event of each kind. This does not tell us which happened first.",
  "Failure, no success recorded":
    "At least one failure event and no success event within the selected dates; this does not prove permanent failure.",
  "Neither event recorded":
    "Other events were observed, but neither a pipeline success nor a pipeline failure was recorded within the selected dates.",
};

export const metricNames = {
  fps: "Frame rate",
  latency: "Latency",
  jitter: "Jitter",
  bitrate: "Bitrate",
};
export const metricHelp = {
  fps: "How many frames were recorded per second.",
  latency:
    "The recorded delay measurement. Its exact unit and producer definition need confirmation.",
  jitter:
    "The recorded variation measurement. Its exact unit and producer definition need confirmation.",
  bitrate:
    "The recorded bitrate measurement. Its unit needs confirmation; this is not total data consumption.",
  accumulatedFrames:
    "A frame-accumulation measurement. Confirm whether it represents waiting frames, an interval count or another producer-defined value.",
  decodeDuration:
    "A decoding-time measurement. Decoding turns video data into frames; confirm the unit and which timing interval this field covers.",
  encodeDuration:
    "An encoding-time measurement. Encoding turns frames into a transferable video stream; confirm the unit and timing boundary.",
  downloadSpeed:
    "A download-throughput measurement. Confirm its recorded unit; an average speed is not total data consumption.",
  skippedFrames:
    "A skipped-frame measurement. Confirm whether it is an interval value or a running counter before interpreting totals.",
};

// Explain the concept without guessing a producer's units or counter semantics.
export function measurementHelp(name) {
  if (metricHelp[name]) return metricHelp[name];
  if (/queue/i.test(name))
    return "A queue-related measurement describes work waiting to be processed. Confirm whether this field measures items, time or a cumulative count.";
  if (/frame|decode/i.test(name))
    return "A frame or decoding measurement. Confirm whether it is a per-interval value or a cumulative counter before interpreting changes.";
  if (/freeze|stall/i.test(name))
    return "A freeze or stall measurement. Confirm whether the field records occurrences, duration or a running total.";
  if (/loss|packet/i.test(name))
    return "A packet-related measurement. Confirm the unit and whether the value is a rate, interval count or running total.";
  return "An additional field recorded by the telemetry producer. Its unit and meaning need confirmation before assigning performance thresholds.";
}
