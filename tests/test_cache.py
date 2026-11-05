"""Check caching in an isolated test cache so fixtures cannot replace live results."""
import os
import unittest
from unittest.mock import patch

import django

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "backend.config")
django.setup()

from backend.repository import performance_report, read
from django.core.cache import cache
from django.test import override_settings
from logic.summary import date_window


class CacheTests(unittest.TestCase):
    def setUp(self):
        # Test fixtures must never replace the running dashboard's cached results.
        settings = override_settings(CACHES={"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}})
        settings.enable()
        self.addCleanup(settings.disable)

    def test_refresh_replaces_old_result_for_same_dates(self):
        cache.clear()
        window = date_window("2026-01-01", "2026-01-31")
        with patch("backend.repository.query", side_effect=[[{"total": 1}], [{"total": 2}]]) as query:
            self.assertEqual(read("overview", window)[0]["total"], 1)
            self.assertEqual(read("overview", window, refresh=True)[0]["total"], 2)
            self.assertEqual(read("overview", window)[0]["total"], 2)
        self.assertEqual(query.call_count, 2)

    def test_empty_summary_is_cached_too(self):
        cache.clear()
        window = date_window("2026-01-01", "2026-01-31")
        with patch("backend.repository.query", return_value=[]) as query:
            self.assertEqual(read("metrics", window), [])
            self.assertEqual(read("metrics", window), [])
        self.assertEqual(query.call_count, 1)

    def test_outside_period_does_not_scan_measurements(self):
        from datetime import date
        with patch("backend.repository.available_range", return_value={"start": date(2026, 8, 3), "end": date(2026, 10, 17)}):
            with patch("backend.repository.read") as read_rows:
                result = performance_report(date_window("2027-01-01", "2027-01-02"))
        self.assertEqual(result, {"metrics": [], "inventory": [], "monthly": []})
        read_rows.assert_not_called()


if __name__ == "__main__":
    unittest.main()
