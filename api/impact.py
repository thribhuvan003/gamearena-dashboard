"""The main page's API (/api/impact/). Reads the chosen dates and filters, runs every
main-page query from api/sql/impact.sql in one batch, and returns the cards, charts,
filters, error table and the open card's session list. With only=list it returns just that list."""
from datetime import timedelta

import psycopg
from django.http import JsonResponse
from django.views.decorators.http import require_GET

from shared import db
from shared.dates import date_window, page_number, percent
from pipeline.rules import DEFINITIONS, SECTIONS, summary

# Sessions per page in a card's list.
PAGE_SIZE = 25
# A card's list goes no further than its first 10,000 sessions (400 pages of 25), so a page
# number can never make the database skip past more rows than that.
MAX_PAGES = 400
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


# Columns a session list can be sorted by; any other value is rejected. With no sort picked,
# the list keeps the card's own order.
SORTS = {"first_seen", "streamed", "fps", "low_fps", "attempts", "drops", "skipped", "wait"}
# The error filter: one error as listed under the error events, picked by all six of these.
ERROR_KEYS = ("error_code", "error_event", "error_stage", "error_phase", "error_reason", "error_after_end")
# What impact_measures returns for each measurement, passed to the page unchanged.
MEASURE_FIELDS = ("average", "readings", "sessions", "typical", "high_tenth", "low_tenth")


class SearchError(ValueError):
    # A search the user typed; its message is shown as it is, unlike other bad addresses.
    pass


def selection(request):
    # The picked dates as a UTC range, plus an optional search for part of a session ID.
    params = date_window(request.GET.get("start", ""), request.GET.get("end", ""))
    params["search"] = request.GET.get("search", "").strip().lower()
    # Session IDs are lowercase UUIDs, so a search may only contain those characters.
    if len(params["search"]) > 36 or any(c not in "0123456789abcdef-" for c in params["search"]):
        raise SearchError("Search: a session ID only has the digits 0-9, the letters a-f and dashes.")
    return params


def choices(request):
    # Filters are tag names separated by commas; a reason is one exact reason line.
    filters = [tag for tag in request.GET.get("filters", "").split(",") if tag]
    reason = request.GET.get("reason", "")
    # Only known groups can be filters; "all" is every session, so it is not one.
    if any(tag not in DEFINITIONS or tag == "all" for tag in filters) or len(reason) > 2000:
        raise ValueError("Unknown filter")
    # The open card, if any. It must be a known group too.
    category = request.GET.get("category")
    if category and category not in DEFINITIONS:
        raise ValueError("Unknown category")
    # Every error has an event name, so a filter with other parts but no event is from a broken link.
    error = {key: request.GET.get(key, "") for key in ERROR_KEYS}
    if (any(len(value) > 2000 for value in error.values())
            or (any(error.values()) and not error["error_event"])
            or error["error_after_end"] not in ("", "0", "1")):
        raise ValueError("Unknown error filter")
    return filters, reason, category, error


def counts(rows):
    # Sessions per tag, from the rows of impact_tags.
    return {row["tag"]: row["sessions"] for row in rows}


def period(tags, totals, measures):
    # The card numbers of one period: its sessions per tag, its totals and its measurements.
    result = summary(counts(tags), totals[0])
    result["measures"] = {row["measure"]: {field: row.get(field) for field in MEASURE_FIELDS} for row in measures}
    return result


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


def facets(tagged, reasons):
    # Every tag and reason with its count under the current filters, largest first, in panel sections.
    sections = []
    for title, keys in SECTIONS.items():
        found = [{"key": tag, "title": DEFINITIONS[tag][0], "count": tagged[tag]} for tag in keys if tagged.get(tag)]
        if found:
            sections.append({"title": title, "tags": sorted(found, key=lambda item: -item["count"])})
    return {"sections": sections, "reasons": [[row["reason"], row["sessions"]] for row in reasons]}


@require_GET
def impact(request):
    try:
        window = selection(request)
        length = window["end"] - window["start"]
        # Over ten years can only be a broken link, and would make the database read everything.
        if length.days > 3660:
            raise ValueError("Period too long")
        filters, reason, category, error = choices(request)
        page = page_number(request.GET.get("page", "1"))
        if page > MAX_PAGES:
            raise ValueError("Page too far")
        # only=list answers with just the open card's list, for opening, paging or sorting it: the
        # rest of the page is already on screen, so 2 reports run instead of 11. It needs an open card.
        only = request.GET.get("only", "")
        if only not in ("", "list") or (only and not category):
            raise ValueError("Unknown part")

        # The filters every query gets; each period adds its own dates.
        shared = {"filters": filters, "reason": reason, **error}
        now = {**shared, "start": window["start"], "end": window["end"]}
        # Compare like with like: a single day (or a few) against the same weekdays a week earlier,
        # a week or more against the same number of days just before.
        shift = timedelta(days=7) if length < timedelta(days=7) else length
        before = {**shared, "start": window["start"] - shift, "end": window["end"] - shift}
        # The trend line covers the selection, or the last TREND_DAYS days when the selection is shorter.
        trend_start = min(window["start"], window["end"] - timedelta(days=TREND_DAYS))
        # Every query the page needs, run in one transaction so all numbers come from the same moment.
        requests = {"tags": ("impact_tags", now), "totals": ("impact_totals", now),
                    # The filter panel's reasons cover every session, whatever card is open or search typed.
                    "reasons": ("impact_reasons", {**now, "category": "all", "search": ""}),
                    "before_tags": ("impact_tags", before), "before_totals": ("impact_totals", before),
                    "measures": ("impact_measures", now), "before_measures": ("impact_measures", before),
                    "error_events": ("impact_error_events", now),
                    "trend": ("impact_trend", {**now, "start": trend_start})}
        # Only when a card is open: one page of its sessions, and the reasons behind its whole list.
        if category:
            listing = {**now, "category": category, "search": window["search"]}
            sort = request.GET.get("sort", "")
            if sort and sort not in SORTS:
                raise ValueError("Unknown sort")
            requests["list"] = ("impact_list", {**listing, "limit": PAGE_SIZE, "offset": (page - 1) * PAGE_SIZE,
                                                "sort": sort, "descending": request.GET.get("order") != "asc"})
            requests["list_reasons"] = ("impact_reasons", listing)
        if only:
            # The list's two reports, exactly as the full request runs them, and nothing else.
            requests = {key: requests[key] for key in ("list", "list_reasons")}
        rows = db.batch(requests)

        if only:
            data = {}
        else:
            previous = period(rows["before_tags"], rows["before_totals"], rows["before_measures"])
            data = {"summary": period(rows["tags"], rows["totals"], rows["measures"]),
                    # No earlier sessions means no change to show, rather than a jump from zero.
                    "previous": previous if previous["sessions"] else None,
                    "facets": facets(counts(rows["tags"]), rows["reasons"]),
                    "titles": {key: title for key, (title, _) in DEFINITIONS.items()},
                    "error_events": rows["error_events"],
                    "trend": trend(rows["trend"], trend_start, window["end"])}
        if category:
            reasons = [[row["reason"], row["sessions"]] for row in rows["list_reasons"]]
            # The list's total is the sum of its reasons, so the two always agree without another count.
            data["sessions"] = {"items": rows["list"], "total": sum(count for _, count in reasons),
                                "max_pages": MAX_PAGES,
                                "page": page, "page_size": PAGE_SIZE,
                                "order": ORDER.get(category, "Newest first"), "reasons": reasons}

        # Never cached: the pipeline updates the numbers every few minutes.
        response = JsonResponse(data)
        response["Cache-Control"] = "no-store"
        return response
    except SearchError as problem:
        return JsonResponse({"error": str(problem)}, status=400)
    except (ValueError, OverflowError):
        # Anything else that is not valid came from an old or edited link.
        return JsonResponse({"error": "Something in this page's address isn't valid. Use Reset view."}, status=400)
    except psycopg.errors.UndefinedTable:
        # The pipeline has not created its tables yet.
        message = "The numbers are still being prepared. They update every few minutes; try again shortly."
        return JsonResponse({"error": message}, status=503)
    except psycopg.errors.QueryCanceled:
        # The database stopped a query at the 3-minute limit; a shorter period reads less.
        return JsonResponse({"error": "This took too long. Try fewer days."}, status=504)
    except psycopg.Error:
        return JsonResponse({"error": "Can't reach the data right now. Try again in a minute."}, status=503)
