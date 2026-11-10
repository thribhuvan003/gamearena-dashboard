"""Serves the built page, and /api/range/: the first and last dates in the data and when the
pipeline last finished, so the page can say how fresh its numbers are."""
from pathlib import Path

import psycopg
from django.http import FileResponse, JsonResponse
from django.views.decorators.http import require_GET

from shared import db
from shared.dates import recent_start

DIST = Path(__file__).resolve().parents[1] / "ui" / "dist"


@require_GET
def date_range(request):
    # First and last recorded dates, so the page never hard-codes a period.
    try:
        dates = db.query("range")[0]
    except (psycopg.errors.UndefinedTable, psycopg.errors.UndefinedColumn):
        error = "Telemetry tables are missing or changed. Check the import."
        return JsonResponse({"error": error}, status=503)
    except psycopg.Error:
        return JsonResponse({"error": "Can't reach the data right now. Try again in a minute."}, status=503)
    # The cards show what the pipeline stored, so the page says how fresh that is.
    try:
        processed = next(iter(db.query("processed")), None)
        if processed:
            # Behind when either table has rows saved after the last run read it.
            now = db.query("process_marks")[0]
            processed["behind"] = any(
                now[key] and (not processed[key] or now[key] > processed[key])
                for key in ("events_until", "stats_until"))
    except psycopg.errors.UndefinedTable:
        processed = None
    except psycopg.Error:
        return JsonResponse({"error": "Can't reach the data right now. Try again in a minute."}, status=503)
    return JsonResponse({**dates, "recent_start": recent_start(dates["start"], dates["end"]),
                         "processed": processed})


@require_GET
def index(request):
    # The built React page, served on the same address as the API.
    page = DIST / "index.html"
    if not page.exists():
        return JsonResponse({"error": "Run scripts\\setup.cmd to build the dashboard first."}, status=503)
    return FileResponse(page.open("rb"), content_type="text/html")
