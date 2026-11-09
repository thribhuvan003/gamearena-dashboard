import os
import unittest
from datetime import date, datetime, timezone
from unittest.mock import patch

import django
import psycopg

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "backend.config")
django.setup()

from django.test import Client  # noqa: E402  (needs django.setup first)


class ApiTests(unittest.TestCase):
    def setUp(self):
        self.client = Client()

    def test_bad_dates_never_reach_database(self):
        with patch("database.repository.batch") as batch:
            response = self.client.get("/api/impact/?start=bad&end=2026-10-17")
        self.assertEqual(response.status_code, 400)
        batch.assert_not_called()

    def test_api_accepts_only_read_requests(self):
        self.assertEqual(self.client.post("/api/range/").status_code, 405)
        self.assertEqual(self.client.post("/api/impact/").status_code, 405)

    def test_unknown_report_is_rejected(self):
        self.assertEqual(self.client.get("/api/arbitrary-sql/").status_code, 404)

    def test_database_error_details_stay_private(self):
        error = psycopg.OperationalError("private-test-marker")
        with patch("database.repository.query", side_effect=error):
            response = self.client.get("/api/range/")
        self.assertEqual(response.status_code, 503)
        self.assertNotIn("private-test-marker", response.content.decode())

    def test_missing_tables_point_to_the_import(self):
        error = psycopg.errors.UndefinedTable("private-test-marker")
        with patch("database.repository.query", side_effect=error):
            response = self.client.get("/api/range/")
        self.assertEqual(response.status_code, 503)
        self.assertIn("import", response.json()["error"])
        self.assertNotIn("private-test-marker", response.content.decode())

    def test_range_includes_the_latest_30_day_boundary(self):
        dates = [{"start": date(2026, 8, 3), "end": date(2026, 10, 17), "last_seen": None}]
        with patch("database.repository.query", side_effect=[dates, []]):
            response = self.client.get("/api/range/")
        self.assertEqual(response.json()["recent_start"], "2026-09-18")
        self.assertIsNone(response.json()["processed"])

    def test_range_says_when_new_data_arrived_after_tagging(self):
        dates = [{"start": date(2026, 8, 3), "end": date(2026, 10, 17), "last_seen": None}]
        tagged = {"finished_at": datetime(2026, 10, 17, 12, tzinfo=timezone.utc),
                  "events_until": datetime(2026, 10, 17, 11, tzinfo=timezone.utc),
                  "stats_until": datetime(2026, 10, 17, 11, tzinfo=timezone.utc)}
        later = datetime(2026, 10, 17, 13, tzinfo=timezone.utc)
        for stats_until, behind in ((tagged["stats_until"], False), (later, True)):
            now = {"events_until": tagged["events_until"], "stats_until": stats_until}
            with patch("database.repository.query", side_effect=[dates, [dict(tagged)], [now]]):
                response = self.client.get("/api/range/")
            self.assertEqual(response.json()["processed"]["behind"], behind)


if __name__ == "__main__":
    unittest.main()
