from uuid import UUID
from math import isfinite

import psycopg
from django.http import JsonResponse
from django.views.decorators.http import require_GET

from backend import repository
from logic.sessions import FILTERS, SORTS, enrich_session, page_number
from logic.summary import date_window
from logic.issues import FPS_REVIEW_THRESHOLD

PAGE_SIZE = 25


def selection(request):
    # Limit ID searches to literal ID characters; dates use the same UTC rules as reports.
    params = date_window(request.GET.get("start", ""), request.GET.get("end", ""))
    params["search"] = request.GET.get("search", "").strip().lower()
    if len(params["search"]) > 36 or any(c not in "0123456789abcdef-" for c in params["search"]):
        raise ValueError("Search must be a session ID or part of one.")
    return params


def session_list(request, params):
    # Count and paginate the same classified rows so a finding matches its session list.
    category = request.GET.get("category", "all")
    sort = request.GET.get("sort", "newest")
    if category not in FILTERS or sort not in SORTS:
        raise ValueError("Choose a supported filter and sort order.")
    params.update({"phase": request.GET.get("phase", ""), "stage": request.GET.get("stage", "")})
    params["error_code"] = request.GET.get("error_code", "")
    if len(params["error_code"]) > 100:
        raise ValueError("Invalid error code.")
    fps_below = request.GET.get("fps_below", "").strip()
    params["fps_below"] = float(fps_below) if fps_below else None
    if params["fps_below"] is not None and (not isfinite(params["fps_below"]) or params["fps_below"] < 0):
        raise ValueError("Invalid FPS threshold.")
    if len(params["phase"]) > 80 or len(params["stage"]) > 80:
        raise ValueError("Invalid failure stage.")
    page = page_number(request.GET.get("page", "1"))
    params.update({"limit": PAGE_SIZE, "offset": (page - 1) * PAGE_SIZE})
    # Only server-owned expressions enter SQL; all reader-entered values stay bound parameters.
    sql = repository.QUERIES["session_list"].replace("{filter}", FILTERS[category]).replace("{sort}", SORTS[sort])
    sql = sql.replace("{fps_sessions}", repository.QUERIES["fps_issue_sessions"].rstrip(";"))
    params["fps_threshold"] = FPS_REVIEW_THRESHOLD
    sql = sql.replace("{performance_filter}", repository.QUERIES["session_fps_filter"].rstrip(";") if fps_below else "TRUE")
    rows = repository.execute(sql, params)
    total = rows[0]["total"] if rows else 0
    items = [enrich_session(row["item"]) for row in rows if row["item"]]
    if items:
        metrics = repository.query("session_page_metrics", {**params, "session_ids": [UUID(str(item["session_id"])) for item in items]})
        by_session = {}
        for metric in metrics:
            by_session.setdefault(str(metric["session_id"]), {})[metric["metric"]] = metric["mean"]
        for item in items:
            item["metrics"] = by_session.get(str(item["session_id"]), {})
    return {"items": items, "total": total, "page": page, "page_size": PAGE_SIZE}


def session_detail(request, params, session_id):
    # Return approved diagnostics and aggregates rather than arbitrary payload contents.
    params["session_id"] = session_id
    rows = repository.query("session_detail", params)
    if not rows:
        return None
    return {"session": enrich_session(rows[0]),
            "connections": repository.query("session_connections", params),
            "metrics": repository.query("session_metrics", params),
            "devices": "Not recorded in the approved session mapping"}


def session_events(request, params, session_id):
    # Keep repeat events: their order is needed to investigate attempts and recovery.
    params.update({"session_id": session_id, "source": request.GET.get("source", ""),
                   "level": request.GET.get("level", ""), "connection": request.GET.get("connection", "")})
    if any(len(params[key]) > 100 for key in ("source", "level", "connection")):
        raise ValueError("Invalid event filter.")
    page = page_number(request.GET.get("page", "1"))
    params.update({"limit": 50, "offset": (page - 1) * 50})
    rows = repository.query("session_events", params)
    return {"items": [row["item"] for row in rows if row["item"]],
            "total": rows[0]["total"], "page": page, "page_size": 50}


@require_GET
def sessions(request, session_id=None, section=None):
    # All session views share one scope, including the optional full recorded history.
    try:
        if section not in {None, "events", "buckets"}:
            return JsonResponse({"error": "This session report does not exist."}, status=404)
        params = selection(request)
        if session_id is not None and request.GET.get("whole") == "1":
            dates = repository.query("session_range", {"session_id": session_id})[0]
            if not dates["start"]:
                return JsonResponse({"error": "No recorded history for this session."}, status=404)
            params.update(date_window(str(dates["start"]), str(dates["end"])))
        if session_id is None:
            data = session_list(request, params)
        elif section == "events":
            data = session_events(request, params, session_id)
        elif section == "buckets":
            params["session_id"] = session_id
            page = page_number(request.GET.get("page", "1"))
            params.update({"limit": 50, "offset": (page - 1) * 50})
            rows = repository.query("session_buckets", params)
            data = {"items": [row["item"] for row in rows if row["item"]],
                    "total": rows[0]["total"], "page": page, "page_size": 50}
        else:
            data = session_detail(request, params, session_id)
        if data is None:
            return JsonResponse({"error": "No session events in these dates."}, status=404)
        response = JsonResponse(data)
        # Session evidence is private and should not remain in browser or proxy caches.
        response["Cache-Control"] = "no-store"
        return response
    except (ValueError, OverflowError):
        return JsonResponse({"error": "Check the dates, session search and selected filters."}, status=400)
    except psycopg.errors.QueryCanceled:
        return JsonResponse({"error": "This investigation took too long. Choose a shorter period."}, status=504)
    except psycopg.Error:
        return JsonResponse({"error": "Session evidence is unavailable. Check the local database and retry."}, status=503)

