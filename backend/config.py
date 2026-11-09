"""Django settings for the local dashboard."""
import os

SECRET_KEY = os.environ.get("DJANGO_SECRET_KEY", "gamearena-local-dashboard")
DEBUG = False
ALLOWED_HOSTS = ["localhost", "127.0.0.1", "testserver"]
ROOT_URLCONF = "backend.urls"
INSTALLED_APPS = []
MIDDLEWARE = ["django.middleware.security.SecurityMiddleware", "django.middleware.common.CommonMiddleware"]
USE_TZ = True
TIME_ZONE = "UTC"
DEFAULT_CHARSET = "utf-8"
