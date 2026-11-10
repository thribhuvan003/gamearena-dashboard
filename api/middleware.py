"""Rules every API request passes through before its view runs."""
from django.http import JsonResponse


def api_guard(get_response):
    def middleware(request):
        # Browsers say where a request came from. A request another website made (say, a hidden
        # image on a page the founder visits) is refused before it can start a database query.
        # Requests typed into the address bar or made by this page itself are let through.
        if request.path.startswith("/api/") and request.headers.get("Sec-Fetch-Site") not in (
                None, "same-origin", "none"):
            return JsonResponse({"error": "Requests from other websites are not allowed."}, status=403)
        response = get_response(request)
        # Answers, including errors, are never cached, so a stale one is never shown.
        if request.path.startswith("/api/"):
            response.setdefault("Cache-Control", "no-store")
        return response
    return middleware
