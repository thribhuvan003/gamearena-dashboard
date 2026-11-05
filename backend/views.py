from pathlib import Path

import psycopg
from django.http import FileResponse, JsonResponse
from django.views.decorators.http import require_GET

from backend import repository
from logic.summary import date_window, explain_outcomes, recent_start

DIST = Path(__file__).resolve().parents[1] / "frontend" / "dist"


@require_GET
def report(request, section):
    """Expose named summaries only. The browser cannot submit its own SQL."""
    try:
        if section not in {"range", "summary", "coverage", "performance", "investigation"}:
            return JsonResponse({"error": "This report does not exist."}, status=404)
        if section == "range":
            dates = repository.available_range(refresh=True)
            return JsonResponse({**dates, "recent_start": recent_start(dates["start"], dates["end"])})
        window = date_window(request.GET.get("start", ""), request.GET.get("end", ""))
        refresh = request.GET.get("refresh") == "1"
        # Every query in this response uses the same validated date window.
        def read(name):
            return repository.read(name, window, refresh)

        # This endpoint combines outcomes, daily counts and failure locations.
        if section == "summary":
            data = {
                "counts": explain_outcomes(read("overview")[0]),
                "trend": read("trend"),
                "failures": read("failures"),
            }
        elif section == "coverage":
            data = read("coverage")[0]
        elif section == "performance":
            data = repository.performance_report(window, refresh)
        # Return counts and timing summaries without returning the underlying events.
        elif section == "investigation":
            data = {"counts": read("investigation")[0], "payload": read("payload"), "readiness": read("readiness")[0]}
        return JsonResponse(data)
    # Explain errors to the reader without exposing database messages or credentials.
    except (ValueError, OverflowError):
        return JsonResponse({"error": "Choose valid start and end dates in the right order."}, status=400)
    except psycopg.errors.QueryCanceled:
        return JsonResponse({"error": "This calculation took too long. Try a shorter date range."}, status=504)
    except (psycopg.errors.UndefinedTable, psycopg.errors.UndefinedColumn):
        return JsonResponse({"error": "The telemetry tables do not match the expected format. Check the data import, then retry."}, status=503)
    except psycopg.Error:
        return JsonResponse({"error": "The database is unavailable. Check Docker and the CockroachDB container, then retry."}, status=503)


@require_GET
def index(request):
    """Serve the built React page on the same local address as the API."""
    page = DIST / "index.html"
    if not page.exists():
        return JsonResponse({"error": "Run setup.cmd to build the dashboard first."}, status=503)
    return FileResponse(page.open("rb"), content_type="text/html")
