import unittest
from datetime import date, datetime, timezone
from unittest.mock import MagicMock, patch

import processor

START = datetime(2026, 10, 1, 23, 50, tzinfo=timezone.utc)
ID = "00000000-0000-4000-8000-000000000000"

# One session that crosses midnight: events on both days, stats only on the first.
REPORTS = {
    "process_events": [
        {"session_id": ID, "day": date(2026, 10, 1), "events": 3, "attempts": 1, "first_seen": START,
         "last_success": START, "first_success": START, "first_ready_ms": 9000.0},
        {"session_id": ID, "day": date(2026, 10, 2), "events": 2, "ends": 1},
    ],
    "process_errors": [{"session_id": ID, "day": date(2026, 10, 2), "error_types": ["ice.candidate.error"],
                        "error_stages": ["Video"]}],
    "process_batches": [{"session_id": ID, "day": date(2026, 10, 1), "batches": 2}],
    "process_seconds": [{"session_id": ID, "day": date(2026, 10, 1), "streamed_seconds": 20,
                         "low_fps_seconds": 0, "high_skip_seconds": 0, "fps_sum": 1200.0, "fps_valid": 20}],
}


class ProcessorTests(unittest.TestCase):
    def run_batch(self):
        connection = MagicMock()
        cursor = connection.cursor.return_value.__enter__.return_value
        with patch("processor.read", side_effect=lambda _, name, params=None: REPORTS[name]):
            processor.process_batch(connection, [ID], "v1")
        return cursor

    def test_a_batch_leaves_the_queue_and_replaces_what_was_stored(self):
        cursor = self.run_batch()
        statements = [call.args[0] for call in cursor.execute.call_args_list]
        self.assertIn("DELETE FROM processor_queue", statements[0])
        self.assertIn("DELETE FROM session_day_analysis", statements[1])
        self.assertIn("DELETE FROM session_analysis", statements[2])

    def test_one_session_row_and_one_row_per_day(self):
        cursor = self.run_batch()
        days, sessions = (call.args[1] for call in cursor.executemany.call_args_list)
        self.assertEqual(sorted(day["day"] for day in days), [date(2026, 10, 1), date(2026, 10, 2)])
        self.assertEqual(sum(day["events"] for day in days), 5)
        self.assertEqual(len(sessions), 1)
        saved = sessions[0]
        self.assertEqual((saved["events"], saved["streamed_seconds"], saved["fps_mean"]), (5, 20, 60))
        self.assertIn("connected", saved["tags"])
        self.assertIn("error_route_attempt", saved["tags"])
        self.assertIn("stage_video", saved["tags"])
        self.assertNotIn("no_end", saved["tags"])
        self.assertEqual((saved["why"], saved["rules_version"]), ("Connected", "v1"))

    def test_rules_version_follows_the_rule_files(self):
        self.assertEqual(processor.rules_version(), processor.rules_version())
        with patch("pathlib.Path.read_bytes", return_value=b"changed rules"):
            changed = processor.rules_version()
        self.assertNotEqual(changed, processor.rules_version())


    def test_a_clash_is_retried_and_other_errors_are_not(self):
        calls = []

        def clash():
            calls.append(1)
            if len(calls) < 3:
                raise processor.psycopg.errors.SerializationFailure()
            return 7

        with patch("processor.time.sleep"):
            self.assertEqual(processor.with_retries(clash), 7)
        self.assertEqual(len(calls), 3)
        with self.assertRaises(ValueError):
            processor.with_retries(lambda: (_ for _ in ()).throw(ValueError()))


if __name__ == "__main__":
    unittest.main()
