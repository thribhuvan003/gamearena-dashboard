import unittest
from unittest.mock import patch

from django.test import Client

from logic.issues import ISSUES, issue_groups
from logic.session_links import session_url


class IssueTests(unittest.TestCase):
    def test_groups_have_shared_denominator_and_can_overlap(self):
        counts = {category: 0 for category, *_ in ISSUES}
        counts.update(total=10, failure=6, ws_error=8)
        groups = issue_groups(counts)
        self.assertEqual(groups[0]["category"], "ws_error")
        self.assertEqual(groups[0]["share"], 80)
        self.assertEqual(sum(group["sessions"] for group in groups), 14)

    def test_empty_period_does_not_claim_a_percentage(self):
        counts = {category: 0 for category, *_ in ISSUES}
        for group in issue_groups({**counts, "total": 0}):
            self.assertIsNone(group["share"])

    def test_error_code_stays_bound(self):
        code = "'; SELECT private_marker --"
        with patch("backend.repository.execute", return_value=[{"total": 0, "item": None}]) as execute:
            response = Client().get("/api/sessions/", {"start": "2026-08-03", "end": "2026-10-17", "error_code": code})
        self.assertEqual(response.status_code, 200)
        sql, params = execute.call_args.args
        self.assertNotIn(code, sql)
        self.assertEqual(params["error_code"], code)

    def test_website_links_require_verified_https_template(self):
        self.assertIsNone(session_url("", "abc"))
        self.assertIsNone(session_url("javascript:{session_id}", "abc"))
        self.assertIsNone(session_url("https://user:secret@example.test/{session_id}", "abc"))
        self.assertEqual(session_url("https://example.test/admin/sessions/{session_id}", "abc"),
                         "https://example.test/admin/sessions/abc")

    def test_bad_dates_and_mutations_never_reach_database(self):
        with patch("backend.repository.execute") as execute:
            self.assertEqual(Client().get("/api/issues/?start=bad&end=bad").status_code, 400)
            self.assertEqual(Client().post("/api/issues/").status_code, 405)
            execute.assert_not_called()
