from logic.dates import percent

LOW_FPS = 30
# Proposed, not yet agreed by the team: a second with 10+ skipped frames is a stutter,
# and a session is flagged when 10% or more of its streamed seconds stutter.
# At 60 FPS, 10 skipped frames is about 15% of the frames in that second.
HIGH_SKIP = 10
HIGH_SKIP_SHARE = 0.10

# Connection rates divide by sessions that tried to connect, not by every session:
# a session with no attempt can neither fail nor succeed.
OF_ATTEMPTED = {"failure", "later_success", "no_later_success", "no_success", "repeated_attempts", "ready",
                "stream_drops"}

# Title and one-line definition of every group a card or list can show.
DEFINITIONS = {
    "all": ("Sessions", "Every session with activity on the selected dates (UTC)."),
    "tried": ("Tried to connect", "Asked to connect at least once."),
    "connected": ("Connected", "Got video at least once."),
    "failure": ("Connection failures", "The app reported a connection error before the session ended."),
    "later_success": ("Error, then connected", "Had a connection error, then connected after it."),
    "no_later_success": ("Error, never connected", "Had a connection error and never connected after it."),
    "no_success": (
        "Never connected",
        "Tried to connect but never got video, whether or not an error was reported.",
    ),
    "failure_after_end": (
        "Errors after the session closed",
        "The app kept retrying a session that had already closed. Not counted as failures.",
    ),
    "low_fps": (
        "Sessions averaging below 30 FPS",
        "Under 30 frames per second on average. 30 is normal for an idle desktop, so only below 30 counts.",
    ),
    "any_low_fps": ("Sessions that dropped below 30 FPS", "Went under 30 frames per second at least once."),
    "fps": ("Sessions with a frame rate", "Every session that reported its frame rate."),
    "ready": ("Wait until video starts", "How long it took from connecting to seeing the first video frame."),
    "stream_drops": (
        "Stream dropped while playing",
        "Connected, then lost the video connection at least once.",
    ),
    "high_skip": (
        "High skipped frames",
        "Proposed rule: 10+ skipped frames in a second, for 10% or more of the session's streamed time.",
    ),
    "repeated_attempts": (
        "Multiple connection attempts",
        "Needed more than one try to connect. A second player joining also counts.",
    ),
    "measured": ("Sent performance stats", "Sent frame rate and network readings."),
    "missing_stats": (
        "No performance stats",
        "Never sent performance stats, so its streamed time is unknown.",
    ),
    "connected_no_stats": (
        "Connected, but sent no stats",
        "Connected, but the player app never sent performance stats, so its time isn't in Streamed hours.",
    ),
    "stats_only": (
        "Stats but no activity",
        "Sent performance stats but no activity events. Not counted as sessions.",
    ),
    "reconnected": ("Player rejoined", "The player dropped and rejoined at least once."),
    "channel_errors": ("Connection channel errors", "The connection channel reported an error at least once."),
    "no_end": ("No end recorded", "Never logged a session end, so it may still be running or the end was lost."),
    "owner": ("Owner joined", "The owner of the host joined the session."),
    "share_link": ("Joined by share link", "Someone joined through a share link."),
    "external_user": ("External user joined", "An external user joined the session."),
    "ended_device_deleted": (
        "Ended: device deleted",
        "The cloud gaming server was removed, by the provider or during a test. Not an error in the session.",
    ),
    "ended_not_in_use": ("Ended: not in use", "The session was closed because it was not being used."),
    "ended_by_user": ("Ended by the user", "The user ended the session."),
}

# Error events, in plain words. Only these become tags, so the tag list cannot grow on its own.
# Connection errors (pipeline.connect.failure) already have their own groups above.
ERROR_TYPES = {
    "pipeline.connection.dropped": (
        "error_dropped", "Error: connection dropped", "The connection dropped after the session had connected."),
    "webrtc.connection.state": (
        "error_video_connection", "Error: video connection failed", "The video connection reported a failure."),
    "ice.connection.state": (
        "error_network_route", "Error: network route failed", "The network path between player and host failed."),
    "ice.candidate.error": (
        "error_route_attempt", "Error: one network path failed",
        "One way of reaching the host failed. Common, and harmless when another way works."),
    "ws.reconnect.exhausted": (
        "error_channel_gave_up", "Error: connection channel gave up", "The connection channel stopped retrying."),
    "media.decode.error": (
        "error_decode", "Error: video could not be decoded", "The player app could not decode the video."),
}
# The part of the app an error came from, exactly as the app names it.
# The team still needs to confirm what "Scream" is; it is shown as sent.
STAGES = ("Session", "JoinSession", "Config", "Device", "Websocket", "WebRTC", "Video", "Scream", "Input", "Cursor")
for key, title, definition in ERROR_TYPES.values():
    DEFINITIONS[key] = (title, definition)
for stage in STAGES:
    DEFINITIONS["stage_" + stage.lower()] = (f"Error at {stage} stage", f"An error came from the {stage} part of the app.")

# How the filter panel groups the tags. Every tag is in exactly one section.
SECTIONS = {
    "Connection": ("tried", "connected", "no_success", "failure", "later_success", "no_later_success",
                   "failure_after_end", "repeated_attempts", "ready", "reconnected", "channel_errors"),
    "Stream quality": ("measured", "missing_stats", "connected_no_stats", "stats_only", "fps", "low_fps",
                       "any_low_fps", "stream_drops", "high_skip"),
    "Error type": tuple(key for key, _, _ in ERROR_TYPES.values()),
    "Error stage": tuple("stage_" + stage.lower() for stage in STAGES),
    "How it ended": ("ended_device_deleted", "ended_not_in_use", "ended_by_user", "no_end"),
    "Who joined": ("owner", "share_link", "external_user"),
}

# Daily facts that are added together across days.
COUNTS = ("events", "attempts", "failures", "failures_after_end", "batches",
          "streamed_seconds", "low_fps_seconds", "fps_sum", "fps_valid",
          "host_connects", "client_connects", "webrtc_failures", "stream_drops", "high_skip_seconds",
          "reconnects", "channel_errors", "ends", "owner_joins", "share_joins", "external_joins",
          "device_deleted_ends", "not_in_use_ends", "user_ends")


def combine_sessions(days):
    # A session that crosses midnight has one row per day; add them so it counts once.
    sessions = {}
    for day in days:
        for row in day:
            sid = str(row["session_id"])
            total = sessions.setdefault(sid, {"session_id": sid, "error_types": [], "error_stages": []})
            for key in COUNTS:
                total[key] = total.get(key, 0) + row.get(key, 0)
            for key in ("error_types", "error_stages"):
                total[key] = sorted(set(total[key]) | set(row.get(key) or ()))
            first, failure, success = row.get("first_seen"), row.get("last_failure"), row.get("last_success")
            if first:
                total["first_seen"] = min(total.get("first_seen") or first, first)
            # The failure detail belongs to the latest failure, whichever day it was on.
            if failure and failure >= (total.get("last_failure") or failure):
                total["last_failure"] = failure
                total["failure_detail"] = row.get("failure_detail")
            if success:
                total["last_success"] = max(total.get("last_success") or success, success)
            # Time to first frame belongs to the session's first success, whichever day it was on.
            started = row.get("first_success")
            if started and started <= (total.get("first_success") or started):
                total["first_success"] = started
                total["first_ready_ms"] = row.get("first_ready_ms")
    for row in sessions.values():
        row["fps_mean"] = row["fps_sum"] / row["fps_valid"] if row["fps_valid"] else None
        row["why"] = why(row)
    return list(sessions.values())


PHASES = {"pre-connect": "before connecting", "connecting": "while connecting", "ended": "after it ended"}
STEPS = {"Session": "session setup", "Config": "settings",
         "Websocket": "connection channel", "Device": "device"}
CODES = {"500": "server error", "400": "request rejected"}


def error_words(detail):
    # "500 / Session / pre-connect" becomes
    # "server error before connecting, at session setup (code 500)".
    # The code stays at the end so engineers can still trace it.
    if not detail:
        return "an error with no code"
    code, step, phase = (detail.split(" / ") + ["", "", ""])[:3]
    words = CODES.get(code, "error")
    if phase:
        words += " " + PHASES.get(phase, phase)
    if step:
        words += ", at " + STEPS.get(step, step)
    return f"{words} (code {code})" if code else words


def why(row):
    # The furthest connection step a session reached, read from the events it logged.
    success, failure = row.get("last_success"), row.get("last_failure")
    if success and failure and failure > success:
        return "Connected, then " + error_words(row.get("failure_detail"))
    if success:
        return "Connected after an error" if failure else "Connected"
    if not row["attempts"]:
        return "Never tried to connect"
    if failure:
        return "Failed: " + error_words(row.get("failure_detail"))
    # No error was reported, so the steps it did report show where it stopped.
    if row["webrtc_failures"]:
        return "No error reported: the video connection failed"
    if not row["host_connects"] and not row["client_connects"]:
        return "No error reported: neither the player nor the host joined"
    if not row["host_connects"]:
        return "No error reported: the host never joined"
    if not row["client_connects"]:
        return "No error reported: the player never joined"
    return "No error reported: both joined but video never started"


def groups(row):
    # Every group a session is in, worked out once. Groups overlap: one session can fail,
    # recover and still have low FPS. Cards, lists and filters all read these, so they always agree.
    measured = row["batches"] > 0 or row["streamed_seconds"] > 0
    if row["events"] == 0:
        return {category: category == "stats_only" and measured for category in DEFINITIONS}
    failed = row["failures"] > 0
    connected = row.get("last_success") is not None
    errors, stages = set(row.get("error_types", ())), set(row.get("error_stages", ()))
    recovered = failed and connected and row["last_success"] > row["last_failure"]
    return {
        "all": True,
        "tried": row["attempts"] > 0,
        "connected": connected,
        "failure": failed,
        "later_success": recovered,
        "no_later_success": failed and not recovered,
        "no_success": row["attempts"] > 0 and not connected,
        "failure_after_end": row["failures_after_end"] > 0 and not failed,
        "low_fps": row["fps_mean"] is not None and row["fps_mean"] < LOW_FPS,
        "any_low_fps": row["low_fps_seconds"] > 0,
        "fps": row["fps_mean"] is not None,
        "ready": row.get("first_ready_ms") is not None,
        "stream_drops": row["stream_drops"] > 0,
        "high_skip": row["streamed_seconds"] > 0
        and row["high_skip_seconds"] >= HIGH_SKIP_SHARE * row["streamed_seconds"],
        "repeated_attempts": row["attempts"] > 1,
        "measured": measured,
        "missing_stats": not measured,
        "connected_no_stats": connected and not measured,
        "stats_only": False,
        "reconnected": row["reconnects"] > 0,
        "channel_errors": row["channel_errors"] > 0,
        "no_end": row["ends"] == 0,
        "owner": row["owner_joins"] > 0,
        "share_link": row["share_joins"] > 0,
        "external_user": row["external_joins"] > 0,
        "ended_device_deleted": row["device_deleted_ends"] > 0,
        "ended_not_in_use": row["not_in_use_ends"] > 0,
        "ended_by_user": row["user_ends"] > 0,
        **{key: name in errors for name, (key, _, _) in ERROR_TYPES.items()},
        **{"stage_" + stage.lower(): stage in stages for stage in STAGES},
    }


def matches(row, category):
    return groups(row)[category]


def tags(row):
    # What the processor stores for a session: every group it is in.
    return [category for category, member in groups(row).items() if member and category != "all"]


def summary(counts, totals):
    # Card numbers from two queries: sessions per tag, and the totals of the selected days.
    sessions = totals["sessions"]
    attempted = counts.get("tried", 0)
    groups = {}
    for category, (title, definition) in DEFINITIONS.items():
        count = {"all": sessions, "stats_only": totals["stats_only"]}.get(category, counts.get(category, 0))
        base = attempted if category in OF_ATTEMPTED else sessions
        share = None if category == "stats_only" else percent(count, base)
        groups[category] = {"title": title, "definition": definition, "count": count, "share": share}
    streamed = totals["streamed_seconds"] / 3600
    low = totals["low_fps_seconds"] / 3600
    # Session shares divide by sessions; the time share divides by streamed time.
    return {"sessions": sessions, "attempted": attempted, "connected": counts.get("connected", 0),
            "groups": groups, "streamed_hours": streamed, "low_fps_hours": low,
            "low_fps_time_share": percent(low, streamed),
            "fps_mean": totals["fps_sum"] / totals["fps_valid"] if totals["fps_valid"] else None,
            "ready_p50": totals["ready_p50"], "ready_p90": totals["ready_p90"]}


# Tags too obvious to repeat on a session's own page.
OBVIOUS = {"tried", "fps", "ready", "measured"}


def enrich_session(row, stored=None):
    # Tags and the reason come from the processor, so a session reads the same here as on the cards.
    result = dict(row)
    start, end = row.get("started_at"), row.get("ended_at")
    # No end recorded: the session ran at least until its last event, so show that as a minimum.
    result["duration_is_minimum"] = bool(start and not end and row.get("last_event_at"))
    stop = end or row.get("last_event_at")
    result["duration_seconds"] = (stop - start).total_seconds() if start and stop and stop >= start else None
    saved = stored["tags"] if stored else []
    result["tags"] = [DEFINITIONS[tag][0] for tag in saved if tag in DEFINITIONS and tag not in OBVIOUS]
    result["why"] = stored["why"] if stored else None
    return result
