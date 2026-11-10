"""Tests for /api/range/ (dates, freshness, database errors) and the guards every API address shares."""
import unittest
from datetime import date, datetime, timezone
from unittest.mock import patch

import psycopg

import helpers  # noqa: F401  (sets up Django)

from django.test import Client  # after helpers, which sets up Django

# The first and last dates the range query would return.
DATES = [{"start": date(2026, 8, 3), "end": date(2026, 10, 17), "last_seen": None}]


# Guards every address shares, and what /api/range/ says about the data's dates and freshness.
class ApiTests(unittest.TestCase):
    def setUp(self):
        self.client = Client()

    def test_bad_dates_never_reach_database(self):
        with patch("shared.db.batch") as batch:
            response = self.client.get("/api/impact/?start=bad&end=2026-10-17")
        self.assertEqual(response.status_code, 400)
        batch.assert_not_called()

    def test_api_accepts_only_read_requests(self):
        self.assertEqual(self.client.post("/api/range/").status_code, 405)
        self.assertEqual(self.client.post("/api/impact/").status_code, 405)

    def test_unknown_report_is_rejected(self):
        # No address runs a query named in the URL; only the routes in api/urls.py exist.
        self.assertEqual(self.client.get("/api/arbitrary-sql/").status_code, 404)

    def test_database_error_details_stay_private(self):
        # A database error's own text can hold query details, so only a plain message is sent.
        error = psycopg.OperationalError("private-test-marker")
        with patch("shared.db.query", side_effect=error):
            response = self.client.get("/api/range/")
        self.assertEqual(response.status_code, 503)
        self.assertNotIn("private-test-marker", response.content.decode())

    def test_missing_tables_point_to_the_import(self):
        error = psycopg.errors.UndefinedTable("private-test-marker")
        with patch("shared.db.query", side_effect=error):
            response = self.client.get("/api/range/")
        self.assertEqual(response.status_code, 503)
        self.assertIn("import", response.json()["error"])
        self.assertNotIn("private-test-marker", response.content.decode())

    def test_range_includes_the_latest_30_day_boundary(self):
        # The last 30 days of data end on the last recorded date, not today. With no pipeline run
        # yet, there is no freshness to report.
        with patch("shared.db.query", side_effect=[DATES, []]):
            response = self.client.get("/api/range/")
        self.assertEqual(response.json()["recent_start"], "2026-09-18")
        self.assertIsNone(response.json()["processed"])

    def test_range_says_when_new_data_arrived_after_tagging(self):
        # Behind when either raw table has rows newer than what the last run read.
        tagged = {"finished_at": datetime(2026, 10, 17, 12, tzinfo=timezone.utc),
                  "events_until": datetime(2026, 10, 17, 11, tzinfo=timezone.utc),
                  "stats_until": datetime(2026, 10, 17, 11, tzinfo=timezone.utc)}
        later = datetime(2026, 10, 17, 13, tzinfo=timezone.utc)
        for stats_until, behind in ((tagged["stats_until"], False), (later, True)):
            now = {"events_until": tagged["events_until"], "stats_until": stats_until}
            with patch("shared.db.query", side_effect=[DATES, [dict(tagged)], [now]]):
                response = self.client.get("/api/range/")
            self.assertEqual(response.json()["processed"]["behind"], behind)


if __name__ == "__main__":
    unittest.main()


# Every pooled connection the pages use is read-only, in UTC and limited to 3 minutes per query.
class PoolTests(unittest.TestCase):
    def test_pooled_connections_are_read_only_utc_and_time_limited(self):
        from unittest.mock import MagicMock
        from shared import db
        connection = MagicMock()
        db._prepare(connection)
        sent = [call.args[0] for call in connection.execute.call_args_list]
        self.assertEqual(sent, ["SET TIME ZONE 'UTC'", "SET statement_timeout = '180s'"])
        self.assertTrue(connection.read_only)
        self.assertFalse(connection.autocommit)


# Requests other websites make are refused; every API answer, errors included, is never cached.
class GuardTests(unittest.TestCase):
    def test_other_websites_cannot_start_queries(self):
        with patch("shared.db.query") as query, patch("shared.db.batch") as batch:
            response = Client().get("/api/range/", HTTP_SEC_FETCH_SITE="cross-site")
        self.assertEqual(response.status_code, 403)
        query.assert_not_called()
        batch.assert_not_called()

    def test_error_answers_are_never_cached(self):
        response = Client().get("/api/impact/", {"start": "bad"}, HTTP_SEC_FETCH_SITE="same-origin")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response["Cache-Control"], "no-store")
