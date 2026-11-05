import unittest
from datetime import datetime, timezone

from logic.summary import date_window, explain_outcomes, percent


class SummaryTests(unittest.TestCase):
    def test_overlapping_outcomes_form_a_partition(self):
        # A session with both flags must not be counted twice in the outcome groups.
        counts = {"total": 10, "succeeded": 7, "failed": 4, "both": 2}
        result = explain_outcomes(counts)
        self.assertEqual([group["count"] for group in result["groups"]], [5, 2, 2, 1])
        self.assertEqual(sum(group["count"] for group in result["groups"]), 10)
        self.assertEqual(result["success_share"], 70)

    def test_empty_period_has_no_measured_percentage(self):
        self.assertIsNone(percent(0, 0))

    def test_end_date_is_inclusive_across_month_boundary(self):
        window = date_window("2026-02-01", "2026-02-28")
        self.assertEqual(window["end"], datetime(2026, 3, 1, tzinfo=timezone.utc))

    def test_invalid_date_ranges_are_rejected(self):
        for dates in [("2026-10-12", "2026-10-01"), ("bad", "2026-10-01")]:
            with self.assertRaises(ValueError):
                date_window(*dates)


if __name__ == "__main__":
    unittest.main()
