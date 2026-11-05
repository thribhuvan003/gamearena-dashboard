"""Check API behavior using a local test client and simulated database failures."""
import os
import unittest
from unittest.mock import patch

import django
import psycopg

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "backend.config")
django.setup()

from django.test import Client


class ApiTests(unittest.TestCase):
    def setUp(self):
        self.client = Client()

    def test_bad_dates_never_reach_database(self):
        with patch("backend.repository.read") as read:
            response = self.client.get("/api/summary/?start=bad&end=2026-10-17")
        self.assertEqual(response.status_code, 400)
        read.assert_not_called()

    def test_api_accepts_only_read_requests(self):
        self.assertEqual(self.client.post("/api/summary/").status_code, 405)

    def test_unknown_report_is_rejected(self):
        self.assertEqual(self.client.get("/api/arbitrary-sql/").status_code, 404)

    def test_database_error_details_stay_private(self):
        with patch("backend.repository.query", side_effect=psycopg.OperationalError("private-test-marker")):
            response = self.client.get("/api/range/")
        self.assertEqual(response.status_code, 503)
        self.assertNotIn("private-test-marker", response.content.decode())

    def test_missing_tables_explain_the_import_problem(self):
        with patch("backend.repository.query", side_effect=psycopg.errors.UndefinedTable("private-test-marker")):
            response = self.client.get("/api/range/")
        self.assertEqual(response.status_code, 503)
        self.assertIn("data import", response.json()["error"])
        self.assertNotIn("private-test-marker", response.content.decode())

    def test_range_includes_the_latest_30_day_boundary(self):
        from datetime import date
        with patch("backend.repository.available_range", return_value={"start": date(2026, 8, 3), "end": date(2026, 10, 17)}):
            response = self.client.get("/api/range/")
        self.assertEqual(response.json()["recent_start"], "2026-09-18")


if __name__ == "__main__":
    unittest.main()
