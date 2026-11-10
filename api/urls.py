"""Which address runs which view: the page itself, /api/range/, /api/impact/ and
/api/sessions/<id>/."""
from django.urls import path, re_path
from django.views.static import serve

from api.impact import impact
from api.sessions import sessions
from api.views import DIST, date_range, index

# The page, its API and its built assets on one local address.
urlpatterns = [
    path("", index),
    path("api/range/", date_range),
    path("api/impact/", impact),
    # <uuid:...> turns away anything that is not a session ID before a query runs.
    path("api/sessions/<uuid:session_id>/", sessions),
    path("api/sessions/<uuid:session_id>/<str:section>/", sessions),
    # The page's built scripts and styles, straight from ui/dist/assets.
    re_path(r"^assets/(?P<path>.*)$", serve, {"document_root": DIST / "assets"}),
]
