import unittest
from datetime import date, datetime, timezone

from logic.dates import date_window, page_number, percent, recent_start


class DateTests(unittest.TestCase):
    def test_empty_period_has_no_percentage(self):
        self.assertIsNone(percent(0, 0))

    def test_end_date_is_inclusive_across_month_boundary(self):
        window = date_window("2026-02-01", "2026-02-28")
        self.assertEqual(window["end"], datetime(2026, 3, 1, tzinfo=timezone.utc))

    def test_invalid_date_ranges_are_rejected(self):
        for dates in [("2026-10-12", "2026-10-01"), ("bad", "2026-10-01")]:
            with self.assertRaises(ValueError):
                date_window(*dates)

    def test_recent_start_is_30_days_ending_at_the_latest_date(self):
        self.assertEqual(recent_start(date(2026, 8, 3), date(2026, 10, 17)), date(2026, 9, 18))
        self.assertEqual(recent_start(date(2026, 10, 10), date(2026, 10, 17)), date(2026, 10, 10))

    def test_page_must_be_positive(self):
        for value in ("0", "-1", "no"):
            with self.assertRaises(ValueError):
                page_number(value)


if __name__ == "__main__":
    unittest.main()
