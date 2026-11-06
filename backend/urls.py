from django.urls import path, re_path
from django.views.static import serve

from backend.views import DIST, index, report
from backend.sessions import sessions

# Keep the page, report endpoints and built assets on one local address.
urlpatterns = [
    path("", index),
    path("api/sessions/", sessions),
    path("api/sessions/<uuid:session_id>/", sessions),
    path("api/sessions/<uuid:session_id>/<str:section>/", sessions),
    path("api/<str:section>/", report),
    re_path(r"^assets/(?P<path>.*)$", serve, {"document_root": DIST / "assets"}),
]
