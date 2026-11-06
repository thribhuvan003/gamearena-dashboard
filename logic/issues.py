from logic.summary import percent

FPS_REVIEW_THRESHOLD = 30
# Each group points back to an existing session predicate; groups can overlap.
ISSUES = [
    ("no_success", "Connection attempted, no success recorded", "attempts",
     "Check setup events and whether success was logged later. Missing success is not proof of permanent failure."),
    ("failure", "Explicit connection failures", "failure_events",
     "Review the failure phase, stage and error code to locate the failing step."),
    ("repeat_reconnect", "Repeated reconnections", "reconnects",
     "Review sessions with more than one reconnect for repeated interruption patterns."),
    ("ws_error", "WebSocket errors", "ws_errors",
     "Inspect socket errors alongside connection outcomes and event timing."),
    ("error", "Error-level events", "errors",
     "Review events the producer marked as errors. A session may still have connected."),
    ("repeated_attempts", "Repeated connection attempts", "attempts",
     "Review sessions that recorded more than one pipeline attempt."),
    ("missing_stats", "Sessions without performance telemetry", None,
     "Check why event-observed sessions have no statistics batch in the selected period."),
    ("missing_end", "Session start without a recorded end", None,
     "Review incomplete lifecycle logging. The selected dates may clip the session history."),
]


def issue_groups(counts):
    # Percentages use all event-observed sessions, not the sum of overlapping groups.
    groups = []
    for category, title, _, explanation in ISSUES:
        count = counts[category]
        groups.append({"category": category, "title": title, "sessions": count,
                       "share": percent(count, counts["total"]),
                       "events": counts.get(category + "_events"), "explanation": explanation})
    return sorted(groups, key=lambda group: (-group["sessions"], group["category"]))
