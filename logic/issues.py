from logic.summary import percent

FPS_REVIEW_THRESHOLD = 30
# Each group points back to an existing session predicate; groups can overlap.
ISSUES = [
    ("no_success", "Connection attempts without a recorded success", "attempts",
     "The session logged a connection attempt, but no pipeline success event appeared within the selected dates.",
     "Check setup events and whether success was logged later. Missing success is not proof of permanent failure."),
    ("failure", "Sessions with a recorded connection failure", "failure_events",
     "At least one pipeline connection failure was logged. The same session may also have connected successfully later.",
     "Review the failure phase, stage and error code to locate the failing step."),
    ("repeat_reconnect", "Sessions that reconnected more than once", "reconnects",
     "More than one client reconnection event was logged in the session. This can include expected reconnects as well as interruptions.",
     "Review sessions with more than one reconnect for repeated interruption patterns."),
    ("ws_error", "WebSocket connection errors", "ws_errors",
     "At least one WebSocket error was logged. A WebSocket is a connection that lets app components keep exchanging messages. This does not prove the whole session failed.",
     "Inspect socket errors alongside connection outcomes and event timing."),
    ("error", "Sessions with logged errors", "errors",
     "At least one event was marked error by the application that recorded it. This is the log's severity label, not a separate count of failed sessions.",
     "Review events the producer marked as errors. A session may still have connected."),
    ("repeated_attempts", "Sessions with multiple connection attempts", "attempts",
     "More than one pipeline connection-attempt event was logged. These may involve different connections within the same session, so not every extra attempt is necessarily a retry.",
     "Check whether these were expected connections or retries."),
    ("missing_stats", "Sessions without performance records", None,
     "Session events were recorded, but no statistics batch was stored for that session within the selected dates. A statistics batch holds readings such as FPS, latency and jitter.",
     "Check why event-observed sessions have no statistics batch in the selected period."),
    ("missing_end", "Sessions with a start but no recorded end", None,
     "A session-start event was logged, but no session-end event appeared within the selected dates. This does not prove a crash; the end may fall outside these dates or be missing from the logs.",
     "Review incomplete lifecycle logging. The selected dates may clip the session history."),
]


def issue_groups(counts):
    # Percentages use all event-observed sessions, not the sum of overlapping groups.
    groups = []
    for category, title, _, meaning, explanation in ISSUES:
        count = counts[category]
        groups.append({"category": category, "title": title, "sessions": count,
                       "share": percent(count, counts["total"]),
                       "events": counts.get(category + "_events"),
                       "meaning": meaning, "explanation": explanation})
    return sorted(groups, key=lambda group: (-group["sessions"], group["category"]))
