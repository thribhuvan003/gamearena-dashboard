import os
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import django

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "backend.config")
django.setup()

from django.test import Client  # noqa: E402  (needs django.setup first)

from logic.rules import enrich_session  # noqa: E402

SESSION = "/api/sessions/00000000-0000-4000-8000-000000000000/"
START = datetime(2026, 10, 1, tzinfo=timezone.utc)


class SessionTests(unittest.TestCase):
    def test_duration_needs_both_ends_in_order(self):
        self.assertEqual(enrich_session({"started_at": START, "ended_at": START + timedelta(minutes=2)})
                         ["duration_seconds"], 120)
        self.assertIsNone(enrich_session({"started_at": START})["duration_seconds"])
        still_open = enrich_session({"started_at": START, "last_event_at": START + timedelta(seconds=9)})
        self.assertEqual((still_open["duration_seconds"], still_open["duration_is_minimum"]), (9, True))
        self.assertIsNone(enrich_session({"started_at": START, "ended_at": START - timedelta(minutes=1)})
                          ["duration_seconds"])

    def test_tags_and_reason_come_from_the_processor(self):
        stored = {"tags": ["tried", "no_success", "owner"], "why": "No error reported: the host never joined"}
        row = enrich_session({"started_at": START}, stored)
        self.assertEqual(row["tags"], ["Never connected", "Owner joined"])
        self.assertEqual(row["why"], stored["why"])
        self.assertEqual(enrich_session({"started_at": START})["tags"], [])

    def test_invalid_scope_never_reaches_database(self):
        client = Client()
        for extra in ({"start": "bad"}, {"search": "' OR TRUE --"}, {"page": "0"}):
            with patch("database.repository.query") as query:
                params = {"start": "2026-08-03", "end": "2026-10-17", **extra}
                self.assertEqual(client.get(SESSION + "events/", params).status_code, 400)
                query.assert_not_called()

    def test_unknown_section_and_writes_are_rejected(self):
        self.assertEqual(Client().get(SESSION + "payload/").status_code, 404)
        self.assertEqual(Client().post(SESSION).status_code, 405)

    def test_empty_page_keeps_the_total(self):
        with patch("database.repository.query", return_value=[{"total": 42, "item": None}]):
            params = {"start": "2026-10-01", "end": "2026-10-01", "page": "3"}
            response = Client().get(SESSION + "buckets/", params)
        self.assertEqual(response.json()["total"], 42)
        self.assertEqual(response.json()["items"], [])
        self.assertEqual(response["Cache-Control"], "no-store")


if __name__ == "__main__":
    unittest.main()
