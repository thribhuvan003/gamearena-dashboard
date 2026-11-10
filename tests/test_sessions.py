"""Tests for the session pop-up's API."""
import unittest
from datetime import timedelta
from unittest.mock import patch

from helpers import SESSION_ID, START

from django.test import Client  # after helpers, which sets up Django

from pipeline.rules import enrich_session

SESSION = f"/api/sessions/{SESSION_ID}/"


def popup(errors):
    # The session pop-up's main request, with every query mocked and the given error rows.
    replies = {"session_detail": [{"started_at": START}], "session_tags": [], "session_connections": [],
               "session_metrics": [], "session_errors": errors}
    with patch("shared.db.query", side_effect=lambda name, params: replies[name]):
        return Client().get(SESSION).json()


class SessionTests(unittest.TestCase):
    def test_duration_needs_both_ends_in_order(self):
        self.assertEqual(enrich_session({"started_at": START, "ended_at": START + timedelta(minutes=2)})
                         ["duration_seconds"], 120)
        self.assertIsNone(enrich_session({"started_at": START})["duration_seconds"])
        still_open = enrich_session({"started_at": START, "last_event_at": START + timedelta(seconds=9)})
        self.assertEqual((still_open["duration_seconds"], still_open["duration_is_minimum"]), (9, True))
        self.assertIsNone(enrich_session({"started_at": START, "ended_at": START - timedelta(minutes=1)})
                          ["duration_seconds"])

    def test_tags_and_reason_come_from_the_pipeline(self):
        stored = {"tags": ["tried", "no_success", "owner"], "why": "No error reported: the host never joined"}
        row = enrich_session({"started_at": START}, stored)
        self.assertEqual(row["tags"], ["Never connected", "Owner joined"])
        self.assertEqual(row["why"], stored["why"])
        self.assertEqual(enrich_session({"started_at": START})["tags"], [])

    def test_outcome_tags_are_not_repeated_beside_the_reason(self):
        stored = {"tags": ["no_success", "outcome_silent", "no_later_success"], "why": "No error reported: x"}
        self.assertEqual(enrich_session({"started_at": START}, stored)["tags"], ["Never connected"])

    def test_invalid_page_or_filter_never_reaches_database(self):
        client = Client()
        for params in ({"page": "0"}, {"level": "x" * 101}):
            with patch("shared.db.query") as query:
                self.assertEqual(client.get(SESSION + "events/", params).status_code, 400)
                query.assert_not_called()

    def test_popup_always_shows_the_whole_session(self):
        # The page's dates, even broken ones, never reach the pop-up's queries.
        with patch("shared.db.query", return_value=[{"total": 0, "item": None}]) as query:
            response = Client().get(SESSION + "events/", {"start": "bad", "end": "2026-10-17"})
        self.assertEqual(response.status_code, 200)
        params = query.call_args.args[1]
        self.assertNotIn("start", params)
        self.assertNotIn("end", params)

    def test_session_errors_keep_the_query_order_and_the_reason_as_sent(self):
        errors = [{"pipeline_event": "pipeline.connect.failure", "error_code": "500", "stage": "Session",
                   "reason": "Made-up reason", "after_end": False, "events": 6},
                  {"pipeline_event": "ice.candidate.error", "error_code": "701", "stage": "WebRTC",
                   "reason": "Made-up path error", "after_end": True, "events": 1}]
        data = popup(errors)["errors"]
        self.assertEqual([(e["events"], e["reason"], e["after_end"]) for e in data],
                         [(6, "Made-up reason", False), (1, "Made-up path error", True)])

    def test_a_known_stage_gets_its_plain_name_beside_it(self):
        errors = [{"stage": "Session"}, {"stage": "Unknown"}, {"stage": None}]
        data = popup(errors)["errors"]
        self.assertEqual([(e["stage"], e["stage_name"]) for e in data],
                         [("Session", "session setup"), ("Unknown", None), (None, None)])

    def test_unknown_section_and_writes_are_rejected(self):
        self.assertEqual(Client().get(SESSION + "payload/").status_code, 404)
        self.assertEqual(Client().post(SESSION).status_code, 405)

    def test_empty_page_keeps_the_total(self):
        with patch("shared.db.query", return_value=[{"total": 42, "item": None}]):
            response = Client().get(SESSION + "buckets/", {"page": "3"})
        self.assertEqual(response.json()["total"], 42)
        self.assertEqual(response.json()["items"], [])
        self.assertEqual(response["Cache-Control"], "no-store")


if __name__ == "__main__":
    unittest.main()
