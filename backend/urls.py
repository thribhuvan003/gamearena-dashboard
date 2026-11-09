from django.urls import path, re_path
from django.views.static import serve

from backend.impact import impact
from backend.sessions import sessions
from backend.views import DIST, date_range, index

# The page, its API and its built assets on one local address.
urlpatterns = [
    path("", index),
    path("api/range/", date_range),
    path("api/impact/", impact),
    path("api/sessions/<uuid:session_id>/", sessions),
    path("api/sessions/<uuid:session_id>/<str:section>/", sessions),
    re_path(r"^assets/(?P<path>.*)$", serve, {"document_root": DIST / "assets"}),
]
