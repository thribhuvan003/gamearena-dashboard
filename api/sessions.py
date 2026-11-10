"""The session pop-up's API (/api/sessions/<id>/): one session's summary, errors, events,
connections and stream quality, read from api/sql/sessions.sql."""
import psycopg
from django.http import JsonResponse
from django.views.decorators.http import require_GET

from shared import db
from shared.dates import page_number
from pipeline.rules import STAGE_NAMES, enrich_session

# Events and statistics batches per page in the pop-up.
PAGE_SIZE = 50


def paged(request, name, params):
    # The query returns the total on every row, and one empty row when the page is past the end.
    page = page_number(request.GET.get("page", "1"))
    rows = db.query(name, {**params, "limit": PAGE_SIZE, "offset": (page - 1) * PAGE_SIZE})
    return {"items": [row["item"] for row in rows if row["item"]],
            "total": rows[0]["total"], "page": page, "page_size": PAGE_SIZE}


def with_stage_name(row):
    # The app's stage name stays as sent; its plain name goes beside it.
    return {**row, "stage_name": STAGE_NAMES.get(row.get("stage"))}


def session_detail(params):
    # The pop-up's first view. None when the session has no events, which the view turns into a 404.
    rows = db.query("session_detail", params)
    if not rows:
        return None
    try:
        stored = next(iter(db.query("session_tags", params)), None)
    except psycopg.errors.UndefinedTable:
        # Before the pipeline's first run there are no stored tags; the session still shows without them.
        stored = None
    return {"session": enrich_session(rows[0], stored),
            "connections": db.query("session_connections", params),
            "metrics": db.query("session_metrics", params),
            "errors": [with_stage_name(row) for row in db.query("session_errors", params)]}


def session_events(request, params):
    # An empty filter means all. Anything over 100 characters is a broken link, turned away before
    # any query runs.
    filters = {key: request.GET.get(key, "") for key in ("source", "level", "connection")}
    if any(len(value) > 100 for value in filters.values()):
        raise ValueError("Invalid event filter.")
    data = paged(request, "session_events", {**params, **filters})
    data["items"] = [with_stage_name(item) for item in data["items"]]
    return data


@require_GET
def sessions(request, session_id, section=None):
    try:
        # Only the two paged sections exist; any other name is a 404, not a query.
        if section not in {None, "events", "buckets"}:
            return JsonResponse({"error": "Unknown session section."}, status=404)
        # The pop-up always shows the whole session, whatever dates the page has selected.
        params = {"session_id": session_id}
        if section == "events":
            data = session_events(request, params)
        elif section == "buckets":
            data = paged(request, "session_buckets", params)
        else:
            data = session_detail(params)
        if data is None:
            return JsonResponse({"error": "No recorded events for this session."}, status=404)
        response = JsonResponse(data)
        # Never cached, so reopening a session always shows its latest events.
        response["Cache-Control"] = "no-store"
        return response
    except ValueError:
        return JsonResponse({"error": "Invalid page or filter."}, status=400)
    except psycopg.errors.QueryCanceled:
        # The database stopped the query at the 3-minute limit set in shared/db.py.
        return JsonResponse({"error": "This took too long. Try again in a minute."}, status=504)
    except psycopg.Error:
        return JsonResponse({"error": "Can't reach the data right now. Try again in a minute."}, status=503)
