"""Django settings for the local dashboard."""
import os

# Django insists on a secret key. Nothing here signs cookies or keeps logins, so a fixed local
# value is enough; DJANGO_SECRET_KEY replaces it.
SECRET_KEY = os.environ.get("DJANGO_SECRET_KEY", "gamearena-local-dashboard")
# Off even on this machine, so an error page never shows code, queries or data.
DEBUG = False
# Only this machine's own addresses. "testserver" is the name Django's test client uses.
ALLOWED_HOSTS = ["localhost", "127.0.0.1", "testserver"]
ROOT_URLCONF = "api.urls"
# No models, admin or logins: every query is plain SQL run through shared/db.py.
INSTALLED_APPS = []
# Standard safety headers, and adding a missing trailing slash to an address.
MIDDLEWARE = ["django.middleware.security.SecurityMiddleware", "django.middleware.common.CommonMiddleware",
              "django.middleware.clickjacking.XFrameOptionsMiddleware"]
# No other site may show the dashboard inside a frame.
X_FRAME_OPTIONS = "DENY"
# Every time is UTC, as on the database connection, so a day always means a UTC day.
USE_TZ = True
TIME_ZONE = "UTC"
DEFAULT_CHARSET = "utf-8"
