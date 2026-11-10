import psycopg
from django.http import JsonResponse
from django.views.decorators.http import require_GET

from database import repository
from logic.dates import date_window, page_number
from logic.rules import enrich_session

PAGE_SIZE = 50


def selection(request):
    # Session IDs are lowercase UUIDs, so a search may only contain those characters.
    params = date_window(request.GET.get("start", ""), request.GET.get("end", ""))
    params["search"] = request.GET.get("search", "").strip().lower()
    if len(params["search"]) > 36 or any(c not in "0123456789abcdef-" for c in params["search"]):
        raise ValueError("Search: a session ID only has the digits 0-9, the letters a-f and dashes.")
    return params


def paged(request, name, params):
    # The query returns the total on every row, and one empty row when the page is past the end.
    page = page_number(request.GET.get("page", "1"))
    rows = repository.query(name, {**params, "limit": PAGE_SIZE, "offset": (page - 1) * PAGE_SIZE})
    return {"items": [row["item"] for row in rows if row["item"]],
            "total": rows[0]["total"], "page": page, "page_size": PAGE_SIZE}


def session_detail(params):
    rows = repository.query("session_detail", params)
    if not rows:
        return None
    try:
        stored = next(iter(repository.query("session_tags", params)), None)
    except psycopg.errors.UndefinedTable:
        stored = None
    return {"session": enrich_session(rows[0], stored),
            "connections": repository.query("session_connections", params),
            "metrics": repository.query("session_metrics", params)}


def session_events(request, params):
    filters = {key: request.GET.get(key, "") for key in ("source", "level", "connection")}
    if any(len(value) > 100 for value in filters.values()):
        raise ValueError("Invalid event filter.")
    return paged(request, "session_events", {**params, **filters})


@require_GET
def sessions(request, session_id, section=None):
    try:
        if section not in {None, "events", "buckets"}:
            return JsonResponse({"error": "Unknown session section."}, status=404)
        params = {**selection(request), "session_id": session_id}
        # "Whole session" replaces the selected dates with the session's own first and last day.
        if request.GET.get("whole") == "1":
            dates = repository.query("session_range", {"session_id": session_id})[0]
            if not dates["start"]:
                return JsonResponse({"error": "No recorded history for this session."}, status=404)
            params.update(date_window(str(dates["start"]), str(dates["end"])))
        if section == "events":
            data = session_events(request, params)
        elif section == "buckets":
            data = paged(request, "session_buckets", params)
        else:
            data = session_detail(params)
        if data is None:
            return JsonResponse({"error": "No session events in these dates."}, status=404)
        response = JsonResponse(data)
        response["Cache-Control"] = "no-store"
        return response
    except (ValueError, OverflowError):
        return JsonResponse({"error": "Invalid dates, search or filter."}, status=400)
    except psycopg.errors.QueryCanceled:
        return JsonResponse({"error": "This took too long. Try fewer days."}, status=504)
    except psycopg.Error:
        return JsonResponse({"error": "Can't reach the data right now. Try again in a minute."}, status=503)
