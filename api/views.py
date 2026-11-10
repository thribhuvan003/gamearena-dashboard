"""Serves the built page, and /api/range/: the first and last dates in the data and when the
pipeline last finished, so the page can say how fresh its numbers are."""
from pathlib import Path

import psycopg
from django.http import FileResponse, JsonResponse
from django.views.decorators.http import require_GET

from shared import db
from shared.dates import recent_start

# Where the built page lives; scripts\setup.cmd builds it.
DIST = Path(__file__).resolve().parents[1] / "ui" / "dist"


@require_GET
def date_range(request):
    # First and last recorded dates, so the page never hard-codes a period.
    try:
        dates = db.query("range")[0]
    except (psycopg.errors.UndefinedTable, psycopg.errors.UndefinedColumn):
        # The raw tables are missing or renamed: a problem with the import, not a passing outage.
        error = "Telemetry tables are missing or changed. Check the import."
        return JsonResponse({"error": error}, status=503)
    except psycopg.Error:
        # Any other database error gets a plain message, so no detail from the database leaks out.
        return JsonResponse({"error": "Can't reach the data right now. Try again in a minute."}, status=503)
    # The cards show what the pipeline stored, so the page says how fresh that is.
    try:
        # Empty until the pipeline has finished its first run.
        processed = next(iter(db.query("processed")), None)
        if processed:
            # Behind when either table has rows saved after the last run read it.
            now = db.query("process_marks")[0]
            processed["behind"] = any(
                now[key] and (not processed[key] or now[key] > processed[key])
                for key in ("events_until", "stats_until"))
    except psycopg.errors.UndefinedTable:
        # The pipeline has never run, so its tables do not exist yet. The dates still show.
        processed = None
    except psycopg.Error:
        return JsonResponse({"error": "Can't reach the data right now. Try again in a minute."}, status=503)
    response = JsonResponse({**dates, "recent_start": recent_start(dates["start"], dates["end"]),
                             "processed": processed})
    # Freshness must never come from a cache.
    response["Cache-Control"] = "no-store"
    return response


@require_GET
def index(request):
    # The built React page, served on the same address as the API.
    page = DIST / "index.html"
    if not page.exists():
        return JsonResponse({"error": "Run scripts\\setup.cmd to build the dashboard first."}, status=503)
    response = FileResponse(page.open("rb"), content_type="text/html")
    # The page may only load its own scripts, styles and data, and can't be framed elsewhere.
    response["Content-Security-Policy"] = (
        "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; "
        "connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'")
    return response
