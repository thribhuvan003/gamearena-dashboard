"""Serve the dashboard and its summaries on the local laptop."""
import os
from pathlib import Path

# This app is for the laptop's local browser. Database access stays in Python.
ROOT = Path(__file__).resolve().parents[1]
SECRET_KEY = os.environ.get("DJANGO_SECRET_KEY", "gamearena-local-dashboard")
DEBUG = False
ALLOWED_HOSTS = ["localhost", "127.0.0.1", "testserver"]
ROOT_URLCONF = "backend.urls"
INSTALLED_APPS = []
MIDDLEWARE = ["django.middleware.security.SecurityMiddleware", "django.middleware.common.CommonMiddleware"]
USE_TZ = True
TIME_ZONE = "UTC"
DEFAULT_CHARSET = "utf-8"

# Use the team's verified session route, with {session_id} where the ID belongs.
GAMEARENA_SESSION_URL = os.environ.get(
    "GAMEARENA_SESSION_URL", "https://alpha.gamearena.tech/admin/sessions/{session_id}"
)

# Save only aggregate results locally, so restarting VS Code does not repeat every sample scan.
CACHES = {"default": {
    "BACKEND": "django.core.cache.backends.filebased.FileBasedCache",
    "LOCATION": ROOT / ".cache",
    "TIMEOUT": 300,
}}
