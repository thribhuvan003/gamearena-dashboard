import psycopg
from django.http import JsonResponse
from django.core.cache import cache
from django.views.decorators.http import require_GET

from backend import repository
from logic.issues import FPS_REVIEW_THRESHOLD, ISSUES, issue_groups
from logic.sessions import FILTERS
from logic.summary import date_window, percent


@require_GET
def issues(request):
    # Aggregate the same classified session rows that the drill-down uses.
    try:
        window = date_window(request.GET.get("start", ""), request.GET.get("end", ""))
        key = f"issue-groups:v2:{window['start'].isoformat()}:{window['end'].isoformat()}"
        result = None if request.GET.get("refresh") == "1" else cache.get(key)
        if result is not None:
            response = JsonResponse(result)
            response["Cache-Control"] = "no-store"
            return response
        columns = ["COUNT(*) AS total"]
        for category, _, event_column, _, _ in ISSUES:
            predicate = FILTERS[category]
            columns.append(f"COUNT(*) FILTER (WHERE {predicate}) AS {category}")
            if event_column:
                columns.append(f"COALESCE(SUM({event_column}) FILTER (WHERE {predicate}), 0) AS {category}_events")
        sql = repository.QUERIES["issue_counts"].replace("{issue_counts}", ", ".join(columns))
        counts = repository.execute(sql, window)[0]
        result = {"total": counts["total"], "groups": issue_groups(counts),
                  "stages": repository.query("failures", window),
                  "codes": repository.query("issue_codes", window)}
        fps = repository.query("fps_issue_count", {**window, "fps_threshold": FPS_REVIEW_THRESHOLD})[0]
        result["groups"].append({"category": "low_fps", "title": f"Sessions with readings below {FPS_REVIEW_THRESHOLD} FPS",
                                 "sessions": fps["sessions"], "share": percent(fps["sessions"], counts["total"]),
                                 "meaning": f"FPS means frames per second: how many image frames are recorded each second. At least one valid reading in this session was below {FPS_REVIEW_THRESHOLD} FPS; it may have been a brief dip.",
                                 "events": None, "explanation": f"At least one valid frame-rate sample was below {FPS_REVIEW_THRESHOLD} FPS. This is an investigation threshold, not proof that the entire session was poor."})
        result["groups"].sort(key=lambda group: (-group["sessions"], group["category"]))
        # Only grouped counts are cached locally; individual session evidence is not cached.
        cache.set(key, result, timeout=300)
        response = JsonResponse(result)
        response["Cache-Control"] = "no-store"
        return response
    except (ValueError, OverflowError):
        return JsonResponse({"error": "Choose valid start and end dates."}, status=400)
    except psycopg.errors.QueryCanceled:
        return JsonResponse({"error": "Issue grouping took too long. Try a shorter period."}, status=504)
    except psycopg.Error:
        return JsonResponse({"error": "Issue groups are unavailable. Check the local database and retry."}, status=503)
