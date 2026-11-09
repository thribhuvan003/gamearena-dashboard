import psycopg
from django.http import JsonResponse
from django.views.decorators.http import require_GET

from database import repository
from backend.sessions import selection
from logic.dates import page_number
from logic.rules import DEFINITIONS, SECTIONS, summary

PAGE_SIZE = 25

# Each card's list starts with the sessions that matter most for that card (see impact_list).
# Everything else is newest first.
ORDER = {
    "low_fps": "Lowest average FPS first",
    "fps": "Lowest average FPS first",
    "any_low_fps": "Most time below 30 FPS first",
    "measured": "Longest streams first",
    "repeated_attempts": "Most attempts first",
    "ready": "Slowest first",
    "stream_drops": "Most drops first",
    "high_skip": "Most skipped-frame time first",
}


def choices(request):
    # Filters are tag names separated by commas; a reason is one exact reason line.
    filters = [tag for tag in request.GET.get("filters", "").split(",") if tag]
    reason = request.GET.get("reason", "")
    if any(tag not in DEFINITIONS or tag == "all" for tag in filters) or len(reason) > 200:
        raise ValueError("Unknown filter")
    category = request.GET.get("category")
    if category and category not in DEFINITIONS:
        raise ValueError("Unknown category")
    return filters, reason, category


def counts(rows):
    return {row["tag"]: row["sessions"] for row in rows}


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
        filters, reason, category = choices(request)
        page = page_number(request.GET.get("page", "1"))

        shared = {"filters": filters, "reason": reason}
        now = {**shared, "start": window["start"], "end": window["end"]}
        # The same number of days just before, so every card can show its change.
        before = {**shared, "start": window["start"] - (window["end"] - window["start"]), "end": window["start"]}
        requests = {"tags": ("impact_tags", now), "totals": ("impact_totals", now),
                    "reasons": ("impact_reasons", {**now, "category": "all", "search": ""}),
                    "before_tags": ("impact_tags", before), "before_totals": ("impact_totals", before)}
        if category:
            listing = {**now, "category": category, "search": window["search"]}
            requests["list"] = ("impact_list", {**listing, "limit": PAGE_SIZE, "offset": (page - 1) * PAGE_SIZE})
            requests["list_reasons"] = ("impact_reasons", listing)
        rows = repository.batch(requests)

        tagged = counts(rows["tags"])
        previous = summary(counts(rows["before_tags"]), rows["before_totals"][0])
        data = {"summary": summary(tagged, rows["totals"][0]),
                "previous": previous if previous["sessions"] else None,
                "facets": facets(tagged, rows["reasons"])}
        if category:
            reasons = [[row["reason"], row["sessions"]] for row in rows["list_reasons"]]
            data["sessions"] = {"items": rows["list"], "total": sum(count for _, count in reasons),
                                "page": page, "page_size": PAGE_SIZE,
                                "order": ORDER.get(category, "Newest first"), "reasons": reasons}

        response = JsonResponse(data)
        response["Cache-Control"] = "no-store"
        return response
    except (ValueError, OverflowError):
        return JsonResponse({"error": "Invalid dates, search, card or filter."}, status=400)
    except psycopg.errors.UndefinedTable:
        return JsonResponse({"error": "The numbers have not been prepared yet. Run process.cmd first."}, status=503)
    except psycopg.errors.QueryCanceled:
        return JsonResponse({"error": "Query timed out. Choose a shorter date range."}, status=504)
    except psycopg.Error:
        return JsonResponse({"error": "Database unavailable."}, status=503)
