from datetime import datetime


FILTERS = {
    "all": "TRUE",
    "attempted": "attempts > 0",
    "success": "success",
    "failure": "failure",
    "success_only": "success AND NOT failure",
    "failure_only": "failure AND NOT success",
    "both": "success AND failure",
    "neither": "NOT success AND NOT failure",
    "no_success": "attempts > 0 AND NOT success",
    "reconnected": "reconnects > 0",
    "repeat_reconnect": "reconnects > 1",
    "disconnected": "disconnects > 0",
    "ws_error": "ws_errors > 0",
    "error": "errors > 0",
    "low_fps": "session_id IN ({fps_sessions})",
    "repeated_attempts": "attempts > 1",
    "missing_stats": "batches = 0",
    "measured": "batches > 0",
    "missing_end": "started_at IS NOT NULL AND ended_at IS NULL",
    "readiness": "ready_count > 0",
}
SORTS = {"newest": "first_seen DESC", "oldest": "first_seen ASC",
         "reconnects": "reconnects DESC", "errors": "ws_errors DESC"}


def enrich_session(row):
    # Tags describe independent observations, allowing success and failure to coexist.
    result = dict(row)
    start, end = row.get("started_at"), row.get("ended_at")
    if isinstance(start, str):
        start = datetime.fromisoformat(start.replace("Z", "+00:00"))
    if isinstance(end, str):
        end = datetime.fromisoformat(end.replace("Z", "+00:00"))
    # A clipped observation window cannot establish the full session duration.
    result["duration_seconds"] = (end - start).total_seconds() if start and end and end >= start else None
    tags = []
    for key, label in (("success", "Recorded success"), ("failure", "Recorded failure"),
                       ("reconnects", "Reconnected"), ("ws_errors", "WebSocket errors")):
        if row.get(key):
            tags.append(label)
    if not row.get("batches"):
        tags.append("No statistics in selection")
    if start and not end:
        tags.append("No end in selection")
    if row.get("first_failure_at") and row.get("last_success_at"):
        if row["first_failure_at"] < row["last_success_at"]:
            tags.append("Failure before later success")
    result["tags"] = tags
    return result


def page_number(value):
    # Bound offsets so accidental inputs cannot request an unlimited result set.
    page = int(value)
    if not 1 <= page <= 100000:
        raise ValueError("Invalid page")
    return page
