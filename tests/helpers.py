"""What the test files share: Django set up once, one start time, one session ID and session()."""
import os
from datetime import datetime, timezone

import django

from pipeline.rules import combine_sessions

# Django must be set up before a test file imports its test client or the views.
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "api.config")
django.setup()

START = datetime(2026, 10, 1, tzinfo=timezone.utc)
SESSION_ID = "00000000-0000-4000-8000-000000000000"


def session(**facts):
    # One session with one event and the given facts, worked out the way the job does it.
    return combine_sessions([[{"session_id": SESSION_ID, "events": 1, **facts}]])[0]
