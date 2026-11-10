"""Every rule in one place: which tags, outcome and reason each session gets, what every card
and filter means, and what each share is out of. Plain Python: no Django, no database."""
from shared.dates import percent

# Frames per second below which a second, or a session's average, counts as low.
LOW_FPS = 30
# Proposed, not yet agreed by the team: a second with 10+ skipped frames is a stutter,
# and a session is flagged when 10% or more of its streamed seconds stutter.
# At 60 FPS, 10 skipped frames is about 17% of the frames in that second.
HIGH_SKIP = 10
HIGH_SKIP_SHARE = 0.10

# Connection rates divide by sessions that tried to connect, not by every session:
# a session with no attempt can neither fail nor succeed.
OF_ATTEMPTED = {"connected", "failure", "later_success", "no_later_success", "no_success", "repeated_attempts"}
# Losing video and the wait for it can only happen once connected; the share of sessions that never
# sent readings is out of the sessions that connected.
OF_CONNECTED = {"ready", "stream_drops", "connected_no_stats"}
# Frame-rate and skipped-frame groups can only include sessions that sent readings, so their
# share is out of those sessions, not out of every session.
OF_MEASURED = {"low_fps", "any_low_fps", "high_skip"}

# Error events by the app's own event names. Only these become tags, so the tag list cannot grow on its own.
# Connection errors (pipeline.connect.failure) already have their own groups below.
# app event name: (tag, title, definition)
ERROR_TYPES = {
    "pipeline.connection.dropped": (
        "error_dropped", "Error: pipeline.connection.dropped",
        "The connection dropped after the session had connected."),
    "webrtc.connection.state": (
        "error_video_connection", "Error: webrtc.connection.state = failed",
        "The video connection (WebRTC) reported the state failed."),
    "ice.connection.state": (
        "error_network_route", "Error: ice.connection.state = failed",
        "Every network path between player and host failed (ICE)."),
    "ice.candidate.error": (
        "error_route_attempt", "Error: ice.candidate.error",
        "One network path to the host (an ICE candidate) failed. The app tries several at once, so this is "
        "usually harmless when another one works."),
    "ws.reconnect.exhausted": (
        "error_channel_gave_up", "Error: ws.reconnect.exhausted",
        "The app gave up reconnecting its WebSocket to our server."),
    "media.decode.error": (
        "error_decode", "Error: media.decode.error", "The player app could not decode the video."),
}
# The part of the app an error came from, in plain words, with the app's own name kept for engineers.
# The team still needs to confirm what "Scream" is, so it is shown as sent.
STAGE_NAMES = {"Session": "session setup", "JoinSession": "joining the session", "Config": "settings",
               "Device": "device", "Websocket": "server connection", "WebRTC": "video connection setup",
               "Video": "video stream", "Scream": "Scream (to be confirmed)", "Input": "keyboard and mouse",
               "Cursor": "cursor"}
# How each session ended up: exactly one per session with events (see outcome()), so these
# add up to all sessions. [key, title, definition]
OUTCOMES = (
    ("outcome_connected", "Connected, no errors", "Got video and the app reported no connection error."),
    ("outcome_recovered", "Connected after an error",
     "A connect attempt failed with an error, then a later one got video."),
    ("outcome_later_failed", "Connected, then a later try failed",
     "Got video, but its last connection error came after its last success (or at the same moment)."),
    ("outcome_failed", "Never connected, failure reported",
     "Never got video; the app sent a failure report (pipeline.connect.failure) before the session ended."),
    ("outcome_silent", "Never connected, no failure report",
     "Tried to connect but never got video, and the app sent no failure report (pipeline.connect.failure) "
     "before the session ended. Other error events may still be there; its reason is the furthest step "
     "it reached."),
    ("outcome_not_tried", "Never tried to connect",
     "The session never made a connect attempt and sent no connection error."),
)

# Title and one-line definition of every group a card or list can show.
DEFINITIONS = {
    "all": ("Sessions", "Every session with activity on the selected dates (UTC)."),
    "tried": ("Tried to connect", "Asked to connect at least once, or reported a connection error."),
    "connected": ("Connected", "Got video at least once."),
    "failure": ("Had a connection error", "The app reported a connection error before the session ended."),
    "later_success": ("Error, then connected", "Had a connection error, then connected after it."),
    "no_later_success": (
        "Error, not connected after it",
        "Had a connection error and did not connect after it, whether or not it had connected before.",
    ),
    "no_success": (
        "Never connected",
        "Tried to connect but never got video, whether or not an error was reported.",
    ),
    "failure_after_end": (
        "Errors after the session closed",
        "Sessions whose only connection errors came after they had closed: the app kept retrying a "
        "session that had already ended. Not counted as failures.",
    ),
    "low_fps": (
        f"Averaged below {LOW_FPS} FPS",
        f"Under {LOW_FPS} frames per second on average. {LOW_FPS} is normal for an idle desktop, "
        f"so only below {LOW_FPS} counts.",
    ),
    "any_low_fps": (f"Dipped below {LOW_FPS} FPS", f"Went under {LOW_FPS} frames per second at least once."),
    "fps": ("Sessions with a frame rate", "Every session that reported its frame rate."),
    "ready": ("Time to video", "Connected and reported how long video took to start."),
    "stream_drops": (
        "Lost video while playing",
        "Connected, then lost the video connection at least once.",
    ),
    "high_skip": (
        "Many skipped frames",
        f"Proposed rule: {HIGH_SKIP}+ skipped frames in a second, for {HIGH_SKIP_SHARE:.0%} or more of the "
        "session's streamed time.",
    ),
    "repeated_attempts": (
        "More than one attempt",
        "Needed more than one try to connect. A second player joining also counts.",
    ),
    "measured": ("Sent stream readings", "The player app sent its per-second readings: frame rate, delay, download speed."),
    "missing_stats": (
        "No stream readings",
        "Never sent stream readings, so its streamed time is unknown.",
    ),
    "connected_no_stats": (
        "Connected, but sent no readings",
        "Got video, but the player app never sent its per-second readings, so its time isn't in Streamed hours.",
    ),
    "stats_only": (
        "Readings but no activity",
        "Sent stream readings but no activity events. Not counted as sessions.",
    ),
    "reconnected": ("Player rejoined", "The player dropped and rejoined at least once."),
    "channel_errors": ("Server connection errors", "The app's connection to our server reported an error at least once."),
    "channel_dropped": ("Server connection dropped", "The app's connection to our server was lost at least once."),
    "channel_recovered": ("Server connection came back", "The app's connection to our server was lost and came back."),
    "route_restarted": ("Network path restarted", "The network path between player and host was restarted."),
    "session_recreated": ("Session recreated", "The session was replaced by a new one with a new ID."),
    "no_end": ("No end recorded", "Never logged a session end, so it may still be running or the end was lost."),
    "owner": ("Owner joined", "The owner of the host joined the session."),
    "share_link": ("Joined by share link", "Someone joined through a share link."),
    "external_user": ("External user joined", "An external user joined the session."),
    "ended_device_deleted": (
        "Ended: gaming server removed",
        "The cloud gaming server was removed, by the provider or during a test. Not an error in the session.",
    ),
    "ended_not_in_use": ("Ended: not in use", "The session was closed because it was not being used."),
    "ended_by_user": ("Ended by the user", "The user ended the session."),
}
# The groups built from the tables above: one per error type, outcome and stage.
for key, title, definition in ERROR_TYPES.values():
    DEFINITIONS[key] = (title, definition)
for key, title, definition in OUTCOMES:
    DEFINITIONS[key] = (title, definition)
for stage, name in STAGE_NAMES.items():
    DEFINITIONS["stage_" + stage.lower()] = (
        f"Error in {stage}", f"An error event was sent with stage {stage} ({name}).")

# How the filter panel groups the tags. Every tag is in exactly one section.
# Only groups a founder would filter by. Groups that repeat another one (Time to video = Connected),
# cover almost every session (Tried to connect), or can be made by picking two filters stay as cards
# and lists but not as filters. Signals only engineers act on sit in their own section, closed by default.
SECTIONS = {
    "Connection": ("connected", "no_success", "failure", "repeated_attempts", "reconnected"),
    "Stream quality": ("measured", "connected_no_stats", "any_low_fps", "low_fps", "stream_drops", "stats_only"),
    "Kind of error": tuple(key for key, _, _ in ERROR_TYPES.values()),
    "Where it failed": tuple("stage_" + stage.lower() for stage in STAGE_NAMES if stage != "Scream"),
    "How it ended": ("ended_device_deleted", "ended_not_in_use", "ended_by_user", "no_end"),
    "Who joined": ("owner", "share_link", "external_user"),
    "Technical signals": ("channel_errors", "channel_dropped", "channel_recovered", "route_restarted",
                          "session_recreated", "failure_after_end", "high_skip", "stage_scream"),
}
# Groups that stay as cards and lists but not as filters (see above). A test checks that every
# group is either here or in exactly one section.
NOT_FILTERS = {"all", "tried", "ready", "fps", "missing_stats", "later_success", "no_later_success",
               *(key for key, _, _ in OUTCOMES)}

# Daily facts that are added together across days.
COUNTS = ("events", "attempts", "failures", "failures_after_end", "batches",
          "streamed_seconds", "low_fps_seconds", "fps_sum", "fps_valid",
          "host_connects", "client_connects", "webrtc_failures", "stream_drops", "high_skip_seconds",
          "reconnects", "channel_errors", "ends", "owner_joins", "share_joins", "external_joins",
          "device_deleted_ends", "not_in_use_ends", "user_ends",
          "channel_drops", "channel_recoveries", "route_restarts", "recreations")


def combine_sessions(days):
    # A session that crosses midnight has one row per day; add them so it counts once.
    sessions = {}
    for day in days:
        for row in day:
            sid = str(row["session_id"])
            total = sessions.setdefault(sid, {"session_id": sid, "error_types": [], "error_stages": []})
            for key in COUNTS:
                total[key] = total.get(key, 0) + row.get(key, 0)
            # The error kinds and stages of every day, each listed once.
            for key in ("error_types", "error_stages"):
                total[key] = sorted(set(total[key]) | set(row.get(key) or ()))
            first, failure, success = row.get("first_seen"), row.get("last_failure"), row.get("last_success")
            # The earliest event of all days.
            if first:
                total["first_seen"] = min(total.get("first_seen") or first, first)
            # The failure detail belongs to the latest failure, whichever day it was on.
            if failure and failure >= (total.get("last_failure") or failure):
                total["last_failure"] = failure
                total["failure_detail"] = row.get("failure_detail")
            # The latest success of all days.
            if success:
                total["last_success"] = max(total.get("last_success") or success, success)
            # Time to video is the value sent with the session's first success, whichever day it was on,
            # and stays empty when that success sent none (the job takes each day's first success too).
            started = row.get("first_success")
            if started and started <= (total.get("first_success") or started):
                total["first_success"] = started
                total["first_ready_ms"] = row.get("first_ready_ms")
    # With every day added, the average frame rate and the reason line can be worked out.
    for row in sessions.values():
        row["fps_mean"] = row["fps_sum"] / row["fps_valid"] if row["fps_valid"] else None
        row["why"] = why(row)
    return list(sessions.values())


# Plain words for the phases and codes connection errors send. Anything else is shown as sent.
PHASES = {"pre-connect": "before connecting", "connecting": "while connecting", "ended": "after it ended"}
CODES = {"500": "server error", "400": "request rejected"}


def error_words(detail):
    # "500 / Session / pre-connect" becomes
    # "server error before connecting, at session setup (code 500)".
    # The code stays at the end so engineers can still trace it.
    if not detail or not detail.replace("/", "").strip():
        return "an error with no code"
    # A detail with fewer than three parts is padded, so a missing part reads as empty.
    code, step, phase = (detail.split(" / ") + ["", "", ""])[:3]
    words = CODES.get(code, "error")
    if phase:
        words += " " + PHASES.get(phase, phase)
    if step:
        words += ", at " + STAGE_NAMES.get(step, step)
    return f"{words} (code {code})" if code else words


def attempted(row):
    # A connection error or a success proves the session tried to connect, even when its attempt
    # event was lost: a session that failed is never "Never tried to connect", and every connected
    # session is among those that tried, so the connected share stays within 100%.
    return row["attempts"] > 0 or row["failures"] > 0 or row.get("last_success") is not None


def outcome(row):
    # How a session ended up, worked out once: why() puts it in words and groups() tags it, so the
    # outcome cards, "Error, then connected" and "Error, not connected after it" can never disagree.
    # Returns one of the OUTCOMES keys, or "stats_only" for a session with readings but no events.
    if not row.get("events"):
        return "stats_only"
    success, failure = row.get("last_success"), row.get("last_failure")
    failed = row["failures"] > 0
    if success is not None and failed:
        # A recovery needs a success after the last error. Both at the same moment counts as failed,
        # since the order of the two is unknown.
        return "outcome_recovered" if failure is not None and success > failure else "outcome_later_failed"
    if success is not None:
        return "outcome_connected"
    if not attempted(row):
        return "outcome_not_tried"
    return "outcome_failed" if failed else "outcome_silent"


def why(row):
    # The session's outcome in words, with the furthest connection step it reached.
    result = outcome(row)
    # Outcomes whose reason needs no detail.
    simple = {"stats_only": "Sent readings but no activity events", "outcome_connected": "Connected",
              "outcome_recovered": "Connected after an error", "outcome_not_tried": "Never tried to connect"}
    if result in simple:
        return simple[result]
    # Outcomes that end on an error: the error itself, in words.
    if result == "outcome_later_failed":
        return "Connected, but a later try failed: " + error_words(row.get("failure_detail"))
    if result == "outcome_failed":
        return "Failed: " + error_words(row.get("failure_detail"))
    # The app sent no failure report (pipeline.connect.failure), so the steps it did report show
    # where it stopped. Other error events may still be there, e.g. the video connection failing.
    if row["webrtc_failures"]:
        return "No failure report: the video connection failed"
    if not row["host_connects"] and not row["client_connects"]:
        return "No failure report: neither the player nor the host joined"
    if not row["host_connects"]:
        return "No failure report: the host never joined"
    if not row["client_connects"]:
        return "No failure report: the player never joined"
    return "No failure report: both joined but video never started"


def groups(row):
    # Every group a session is in, worked out once. Groups overlap: one session can fail,
    # recover and still have low FPS. Cards, lists and filters all read these, so they always agree.
    # Sent readings: a stored batch or at least one counted second.
    measured = row["batches"] > 0 or row["streamed_seconds"] > 0
    # A session with readings but no events is only in "Readings but no activity", and only if it
    # really sent some.
    if row["events"] == 0:
        return {category: category == "stats_only" and measured for category in DEFINITIONS}
    failed = row["failures"] > 0
    connected = row.get("last_success") is not None
    tried = attempted(row)
    errors, stages = set(row.get("error_types", ())), set(row.get("error_stages", ()))
    result = outcome(row)
    return {
        "all": True,
        "tried": tried,
        "connected": connected,
        "failure": failed,
        # Read from the outcome, so these always add up with the outcome cards.
        "later_success": result == "outcome_recovered",
        "no_later_success": result in ("outcome_later_failed", "outcome_failed"),
        "no_success": tried and not connected,
        # Only errors after it closed: a session with a real error as well is a failure instead.
        "failure_after_end": row["failures_after_end"] > 0 and not failed,
        "low_fps": row["fps_mean"] is not None and row["fps_mean"] < LOW_FPS,
        "any_low_fps": row["low_fps_seconds"] > 0,
        "fps": row["fps_mean"] is not None,
        "ready": row.get("first_ready_ms") is not None,
        "stream_drops": row["stream_drops"] > 0,
        # Stutter in at least HIGH_SKIP_SHARE of its streamed seconds; nothing streamed, never flagged.
        "high_skip": row["streamed_seconds"] > 0
        and row["high_skip_seconds"] >= HIGH_SKIP_SHARE * row["streamed_seconds"],
        "repeated_attempts": row["attempts"] > 1,
        "measured": measured,
        "missing_stats": not measured,
        "connected_no_stats": connected and not measured,
        "stats_only": False,
        "reconnected": row["reconnects"] > 0,
        "channel_errors": row["channel_errors"] > 0,
        "channel_dropped": row["channel_drops"] > 0,
        "channel_recovered": row["channel_recoveries"] > 0,
        "route_restarted": row["route_restarts"] > 0,
        "session_recreated": row["recreations"] > 0,
        "no_end": row["ends"] == 0,
        "owner": row["owner_joins"] > 0,
        "share_link": row["share_joins"] > 0,
        "external_user": row["external_joins"] > 0,
        "ended_device_deleted": row["device_deleted_ends"] > 0,
        "ended_not_in_use": row["not_in_use_ends"] > 0,
        "ended_by_user": row["user_ends"] > 0,
        # One tag per known error type, per stage and per outcome.
        **{key: name in errors for name, (key, _, _) in ERROR_TYPES.items()},
        **{"stage_" + stage.lower(): stage in stages for stage in STAGE_NAMES},
        **{key: key == result for key, _, _ in OUTCOMES},
    }


def tags(row):
    # What the pipeline stores for a session: every group it is in.
    return [category for category, member in groups(row).items() if member and category != "all"]


def summary(counts, totals):
    # Card numbers from two queries: sessions per tag, and the totals of the selected days.
    sessions = totals["sessions"]
    cards = {}
    for category, (title, definition) in DEFINITIONS.items():
        # "all" and "stats_only" come from the totals; every other card from the tag counts.
        count = {"all": sessions, "stats_only": totals["stats_only"]}.get(category, counts.get(category, 0))
        # What the share is out of: see OF_ATTEMPTED, OF_CONNECTED and OF_MEASURED above.
        if category in OF_ATTEMPTED:
            base = counts.get("tried", 0)
        elif category in OF_CONNECTED:
            base = counts.get("connected", 0)
        elif category in OF_MEASURED:
            base = counts.get("measured", 0)
        else:
            base = sessions
        # Readings-only sessions are not counted as sessions, so they have no share of them.
        share = None if category == "stats_only" else percent(count, base)
        cards[category] = {"title": title, "definition": definition, "count": count, "share": share, "base": base}
    streamed = totals["streamed_seconds"] / 3600
    low = totals["low_fps_seconds"] / 3600
    # Session shares divide by sessions; the time share divides by streamed time.
    return {"sessions": sessions, "attempted": counts.get("tried", 0), "connected": counts.get("connected", 0),
            "groups": cards, "streamed_hours": streamed, "low_fps_hours": low,
            "low_fps_time_share": percent(low, streamed),
            "fps_mean": totals["fps_sum"] / totals["fps_valid"] if totals["fps_valid"] else None,
            "ready_p50": totals["ready_p50"], "ready_p90": totals["ready_p90"]}


# Tags too obvious to repeat on a session's own page. The outcome tags only repeat its reason line.
OBVIOUS = {"tried", "fps", "ready", "measured", "later_success", "no_later_success",
           *(key for key, _, _ in OUTCOMES)}


def enrich_session(row, stored=None):
    # Tags and the reason come from the pipeline, so a session reads the same here as on the cards.
    result = dict(row)
    start, end = row.get("started_at"), row.get("ended_at")
    # No end recorded: the session ran at least until its last event, so show that as a minimum.
    result["duration_is_minimum"] = bool(start and not end and row.get("last_event_at"))
    stop = end or row.get("last_event_at")
    result["duration_seconds"] = (stop - start).total_seconds() if start and stop and stop >= start else None
    # Before the first pipeline run nothing is stored, so no tags and no reason. A tag stored by an
    # older rules version that no longer exists is skipped.
    saved = stored["tags"] if stored else []
    result["tags"] = [DEFINITIONS[tag][0] for tag in saved if tag in DEFINITIONS and tag not in OBVIOUS]
    result["why"] = stored["why"] if stored else None
    return result
