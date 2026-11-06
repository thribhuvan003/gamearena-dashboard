import unittest
from datetime import datetime, timezone
from unittest.mock import patch

from django.test import Client
from logic.sessions import enrich_session, page_number


class SessionTests(unittest.TestCase):
    def test_overlapping_evidence_and_incomplete_lifecycle(self):
        row = enrich_session({"success": True, "failure": True, "reconnects": 2,
                              "started_at": datetime(2026, 10, 1, tzinfo=timezone.utc)})
        self.assertIn("Recorded success", row["tags"])
        self.assertIn("Recorded failure", row["tags"])
        self.assertIn("Reconnected", row["tags"])
        self.assertIsNone(row["duration_seconds"])

    def test_duration_from_json_timestamps(self):
        row = enrich_session({"started_at": "2026-10-01T23:59:00Z", "ended_at": "2026-10-02T00:01:00Z"})
        self.assertEqual(row["duration_seconds"], 120)
        self.assertIsNone(enrich_session({"started_at": "2026-10-02T00:01:00Z", "ended_at": "2026-10-01T23:59:00Z"})["duration_seconds"])

    def test_invalid_filters_never_execute_sql(self):
        client = Client()
        for extra in ({"category": "TRUE; DROP TABLE x"}, {"sort": "arbitrary"},
                      {"search": "' OR TRUE --"}, {"page": "0"}, {"page": "no"}):
            with patch("backend.repository.execute") as execute:
                response = client.get("/api/sessions/", {"start": "2026-08-03", "end": "2026-10-17", **extra})
                self.assertEqual(response.status_code, 400)
                execute.assert_not_called()

    def test_empty_page_retains_total(self):
        with patch("backend.repository.execute", return_value=[{"total": 42, "item": None}]):
            response = Client().get("/api/sessions/", {"start": "2026-08-03", "end": "2026-10-17", "page": "3"})
        self.assertEqual(response.json()["total"], 42)
        self.assertEqual(response.json()["items"], [])
        self.assertEqual(response["Cache-Control"], "no-store")

    def test_read_only_endpoints(self):
        self.assertEqual(Client().post("/api/sessions/").status_code, 405)
        with self.assertRaises(ValueError):
            page_number("-1")

    def test_failure_then_success_has_chronological_evidence(self):
        row = enrich_session({"success": True, "failure": True,
                              "first_failure_at": "2026-10-01T00:00:00Z",
                              "last_success_at": "2026-10-01T00:01:00Z"})
        self.assertIn("Failure before later success", row["tags"])
        row = enrich_session({"first_failure_at": "2026-10-01T00:01:00Z",
                              "last_success_at": "2026-10-01T00:00:00Z"})
        self.assertNotIn("Failure before later success", row["tags"])

    def test_stage_values_remain_parameters(self):
        stage = "'; SELECT private_marker --"
        with patch("backend.repository.execute", return_value=[{"total": 0, "item": None}]) as execute:
            response = Client().get("/api/sessions/", {"start": "2026-08-03", "end": "2026-10-17", "stage": stage})
        self.assertEqual(response.status_code, 200)
        sql, params = execute.call_args.args
        self.assertNotIn(stage, sql)
        self.assertEqual(params["stage"], stage)

    def test_invalid_performance_thresholds(self):
        for threshold in ("NaN", "Infinity", "-1", "bad"):
            with patch("backend.repository.execute") as execute:
                response = Client().get("/api/sessions/", {"start": "2026-08-03", "end": "2026-10-17", "fps_below": threshold})
                self.assertEqual(response.status_code, 400)
                execute.assert_not_called()
