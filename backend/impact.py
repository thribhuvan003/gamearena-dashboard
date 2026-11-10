from datetime import timedelta

import psycopg
from django.http import JsonResponse
from django.views.decorators.http import require_GET

from database import repository
from backend.sessions import selection
from logic.dates import page_number, percent
from logic.rules import DEFINITIONS, SECTIONS, summary

PAGE_SIZE = 25
# The trend lines cover at least this many days, ending on the last selected day.
# Four weeks of daily values: enough to tell a real change from everyday ups and downs.
TREND_DAYS = 28

# Each card's list starts with the sessions that matter most for that card (see impact_list).
# Everything else is newest first.
ORDER = {
    "low_fps": "Lowest average FPS first",
    "fps": "Lowest average FPS first",
    "any_low_fps": "Most time below 30 FPS first",
    "measured": "Longest streams first",
    "repeated_attempts": "Most attempts first",
    "ready": "Slowest first",
    "stream_drops": "Most times video was lost first",
    "high_skip": "Most skipped-frame time first",
}


# Columns a session list can be sorted by. Anything else keeps the card's own order.
SORTS = {"first_seen", "streamed", "fps", "low_fps", "attempts", "drops", "skipped", "wait"}


def choices(request):
    # Filters are tag names separated by commas; a reason is one exact reason line.
    filters = [tag for tag in request.GET.get("filters", "").split(",") if tag]
    reason = request.GET.get("reason", "")
    if any(tag not in DEFINITIONS or tag == "all" for tag in filters) or len(reason) > 200:
        raise ValueError("Unknown filter")
    category = request.GET.get("category")
    if category and category not in DEFINITIONS:
        raise ValueError("Unknown category")
    # One error code with the event and reason it came with, as listed under "Error codes and their reasons".
    error = {key: request.GET.get(key, "") for key in ("error_code", "error_event", "error_reason",
                                                         "error_after_end")}
    if any(len(value) > 300 for value in error.values()):
        raise ValueError("Unknown error filter")
    return filters, reason, category, error


def counts(rows):
    return {row["tag"]: row["sessions"] for row in rows}


def trend(rows, start, end):
    # Every day in the range, with zero sessions on days that had none, so the line has no gaps.
    by_day = {row["day"]: row for row in rows}
    days = []
    day = start.date()
    while day < end.date():
        row = by_day.get(day, {})
        tried = row.get("tried", 0)
        days.append({"day": day, "sessions": row.get("sessions", 0), "tried": tried,
                     "never_connected_share": percent(row.get("never_connected", 0), tried),
                     "ready_p50": row.get("ready_p50"), "streamed_hours": row.get("streamed_seconds", 0) / 3600,
                     "low_fps_time_share": percent(row.get("low_fps_seconds", 0), row.get("streamed_seconds", 0)),
                     "fps_mean": row.get("fps_mean")})
        day += timedelta(days=1)
    return days


MEASURE_FIELDS = ("average", "readings", "sessions", "typical", "high_tenth", "low_tenth")


def averages(rows):
    return {row["measure"]: {field: row.get(field) for field in MEASURE_FIELDS} for row in rows}


def facets(tagged, reasons):
    # Every tag and reason with its count under the current filters, largest first, in panel sections.
    sections = [{"title": title, "tags": sorted(
        ({"key": tag, "title": DEFINITIONS[tag][0], "count": tagged[tag]} for tag in tags if tagged.get(tag)),
        key=lambda item: -item["count"])} for title, tags in SECTIONS.items()]
    return {"sections": [section for section in sections if section["tags"]],
            "reasons": [[row["reason"], row["sessions"]] for row in reasons]}


@require_GET
def impact(request):
    try:
        window = selection(request)
        if (window["end"] - window["start"]).days > 3660:
            raise ValueError("Period too long")
        filters, reason, category, error = choices(request)
        page = page_number(request.GET.get("page", "1"))

        shared = {"filters": filters, "reason": reason, **error}
        now = {**shared, "start": window["start"], "end": window["end"]}
        # Compare like with like: a single day (or a few) against the same weekdays a week earlier,
        # a week or more against the same number of days just before.
        length = window["end"] - window["start"]
        shift = timedelta(days=7) if length < timedelta(days=7) else length
        before = {**shared, "start": window["start"] - shift, "end": window["end"] - shift}
        requests = {"tags": ("impact_tags", now), "totals": ("impact_totals", now),
                    "reasons": ("impact_reasons", {**now, "category": "all", "search": ""}),
                    "before_tags": ("impact_tags", before), "before_totals": ("impact_totals", before),
                    "measures": ("impact_measures", now), "before_measures": ("impact_measures", before),
                    "error_reasons": ("impact_error_reasons", now),
                    "trend": ("impact_trend", {**now, "start": min(window["start"],
                                                                  window["end"] - timedelta(days=TREND_DAYS))})}
        if category:
            listing = {**now, "category": category, "search": window["search"]}
            sort = request.GET.get("sort", "")
            if sort and sort not in SORTS:
                raise ValueError("Unknown sort")
            requests["list"] = ("impact_list", {**listing, "limit": PAGE_SIZE, "offset": (page - 1) * PAGE_SIZE,
                                                "sort": sort, "descending": request.GET.get("order") != "asc"})
            requests["list_reasons"] = ("impact_reasons", listing)
        rows = repository.batch(requests)

        tagged = counts(rows["tags"])
        previous = summary(counts(rows["before_tags"]), rows["before_totals"][0])
        previous["measures"] = averages(rows["before_measures"])
        current = summary(tagged, rows["totals"][0])
        current["measures"] = averages(rows["measures"])
        data = {"summary": current,
                "previous": previous if previous["sessions"] else None,
                "facets": facets(tagged, rows["reasons"]),
                "titles": {key: title for key, (title, _) in DEFINITIONS.items()},
                "error_reasons": rows["error_reasons"],
                "trend": trend(rows["trend"], min(window["start"], window["end"] - timedelta(days=TREND_DAYS)),
                               window["end"])}
        if category:
            reasons = [[row["reason"], row["sessions"]] for row in rows["list_reasons"]]
            data["sessions"] = {"items": rows["list"], "total": sum(count for _, count in reasons),
                                "page": page, "page_size": PAGE_SIZE,
                                "order": ORDER.get(category, "Newest first"), "reasons": reasons}

        response = JsonResponse(data)
        response["Cache-Control"] = "no-store"
        return response
    except (ValueError, OverflowError) as problem:
        # A bad search gets its own message; anything else came from an old or edited link.
        message = str(problem) if str(problem).startswith("Search") else \
            "Something in this page's address isn't valid. Use Reset view."
        return JsonResponse({"error": message}, status=400)
    except psycopg.errors.UndefinedTable:
        return JsonResponse({"error": "The numbers are still being prepared. They update every few minutes; try again shortly."}, status=503)
    except psycopg.errors.QueryCanceled:
        return JsonResponse({"error": "This took too long. Try fewer days."}, status=504)
    except psycopg.Error:
        return JsonResponse({"error": "Can't reach the data right now. Try again in a minute."}, status=503)
