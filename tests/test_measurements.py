import unittest
from datetime import date

from logic.measurements import combine_inventory, combine_measurements, monthly_measurements
from logic.summary import date_window, recent_start


class MeasurementTests(unittest.TestCase):
    def test_mean_uses_sample_counts_not_average_of_day_averages(self):
        rows = [
            {"day": date(2026, 10, 1), "metric": "fps", "entries": 2, "valid": 1, "missing": 1, "invalid": 0, "total": 10, "minimum": 10, "maximum": 10},
            {"day": date(2026, 10, 2), "metric": "fps", "entries": 10, "valid": 9, "missing": 0, "invalid": 1, "total": 450, "minimum": 50, "maximum": 50},
        ]
        result = combine_measurements(rows, date_window("2026-10-01", "2026-10-02"))[0]
        self.assertEqual(result["mean"], 46)
        self.assertEqual((result["valid"], result["missing"], result["invalid"]), (10, 1, 1))
        self.assertEqual((result["minimum"], result["maximum"]), (10, 50))
        one_day = combine_measurements(rows, date_window("2026-10-02", "2026-10-02"))[0]
        self.assertEqual(one_day["mean"], 50)

    def test_null_only_measurement_has_no_average(self):
        rows = [{"day": date(2026, 10, 1), "metric": "fps", "entries": 3, "valid": 0, "missing": 3, "invalid": 0, "total": None, "minimum": None, "maximum": None}]
        self.assertIsNone(combine_measurements(rows, date_window("2026-10-01", "2026-10-01"))[0]["mean"])
        self.assertEqual(combine_measurements(rows, date_window("2026-11-01", "2026-11-01")), [])

    def test_inventory_counts_only_selected_days(self):
        rows = [{"day": date(2026, 10, 1), "metric": "fps", "present_rows": 5, "array_rows": 4}, {"day": date(2026, 10, 2), "metric": "fps", "present_rows": 8, "array_rows": 7}]
        result = combine_inventory(rows, date_window("2026-10-02", "2026-10-02"))[0]
        self.assertEqual((result["present_rows"], result["array_rows"]), (8, 7))

    def test_latest_30_days_crosses_month_and_year_boundaries(self):
        self.assertEqual(recent_start(date(2026, 8, 3), date(2026, 10, 17)), date(2026, 9, 18))
        self.assertEqual(recent_start(date(2025, 1, 1), date(2026, 1, 18)), date(2025, 12, 20))
        self.assertEqual(recent_start(date(2024, 1, 1), date(2024, 2, 29)), date(2024, 1, 31))

    def test_short_or_empty_dataset(self):
        self.assertEqual(recent_start(date(2026, 10, 10), date(2026, 10, 17)), date(2026, 10, 10))
        self.assertIsNone(recent_start(None, None))

    def test_monthly_comparison_respects_selected_dates(self):
        rows = [{"day": day, "metric": "fps", "entries": 1, "valid": 1, "missing": 0, "invalid": 0, "total": value, "minimum": value, "maximum": value} for day, value in [(date(2026, 9, 30), 20), (date(2026, 10, 1), 40), (date(2026, 10, 2), 60)]]
        result = monthly_measurements(rows, date_window("2026-09-30", "2026-10-01"))
        self.assertEqual([item["month"] for item in result], ["2026-09", "2026-10"])
        self.assertEqual([item["metrics"][0]["mean"] for item in result], [20, 40])
