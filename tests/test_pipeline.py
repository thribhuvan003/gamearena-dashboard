"""Tests for the batch job: what one batch saves, the rules version, retries and the
--every loop."""
import unittest
from datetime import date
from unittest.mock import MagicMock, call, patch

from helpers import SESSION_ID, START

from pipeline import job
from shared.db import QUERIES

MEASURE = {"session_id": SESSION_ID, "day": date(2026, 10, 1), "measure": "fps", "total": 1200.0, "readings": 20}
ERROR_EVENT = {"session_id": SESSION_ID, "day": date(2026, 10, 2), "event": "ice.candidate.error", "code": "701",
               "stage": "Video", "phase": "connecting", "reason": "test reason", "after_end": False, "events": 2}
# One session that crosses midnight: events on both days, stats only on the first.
REPORTS = {
    "process_events": [
        {"session_id": SESSION_ID, "day": date(2026, 10, 1), "events": 3, "attempts": 1, "first_seen": START,
         "last_success": START, "first_success": START, "first_ready_ms": 9000.0},
        {"session_id": SESSION_ID, "day": date(2026, 10, 2), "events": 2, "ends": 1},
    ],
    "process_errors": [{"session_id": SESSION_ID, "day": date(2026, 10, 2), "error_types": ["ice.candidate.error"],
                        "error_stages": ["Video"]}],
    "process_batches": [{"session_id": SESSION_ID, "day": date(2026, 10, 1), "batches": 2}],
    "process_error_events": [ERROR_EVENT],
    "process_measures": [MEASURE],
    "process_seconds": [{"session_id": SESSION_ID, "day": date(2026, 10, 1), "streamed_seconds": 20,
                         "low_fps_seconds": 0, "high_skip_seconds": 0, "fps_sum": 1200.0, "fps_valid": 20}],
}


class Stop(Exception):
    # Ends the otherwise endless --every loop in a test.
    pass


class ProcessorTests(unittest.TestCase):
    def run_batch(self):
        connection = MagicMock()
        cursor = connection.cursor.return_value.__enter__.return_value
        with patch("pipeline.job.read", side_effect=lambda _, name, params=None: REPORTS[name]):
            job.process_batch(connection, [SESSION_ID], "v1")
        return cursor

    def saved(self, cursor, name):
        # The rows one save statement was given, found by the statement itself, not by its position.
        return next(c.args[1] for c in cursor.executemany.call_args_list if c.args[0] == QUERIES[name])

    def test_a_batch_leaves_the_queue_and_replaces_everything_it_stored(self):
        cursor = self.run_batch()
        statements = [c.args[0] for c in cursor.execute.call_args_list]
        self.assertEqual(statements, [QUERIES[name] for name in (
            "process_dequeue", "process_clear_days", "process_clear_sessions", "process_clear_measures",
            "process_clear_error_events")])
        for c in cursor.execute.call_args_list:
            self.assertEqual(c.args[1], {"ids": [SESSION_ID]})

    def test_one_session_row_and_one_row_per_day(self):
        cursor = self.run_batch()
        days = self.saved(cursor, "process_save_day")
        self.assertEqual(sorted(day["day"] for day in days), [date(2026, 10, 1), date(2026, 10, 2)])
        self.assertEqual(sum(day["events"] for day in days), 5)
        sessions = self.saved(cursor, "process_save_session")
        self.assertEqual(len(sessions), 1)
        saved = sessions[0]
        self.assertEqual((saved["events"], saved["streamed_seconds"], saved["fps_mean"]), (5, 20, 60))
        self.assertIn("connected", saved["tags"])
        self.assertIn("error_route_attempt", saved["tags"])
        self.assertIn("stage_video", saved["tags"])
        self.assertNotIn("no_end", saved["tags"])
        self.assertEqual((saved["why"], saved["rules_version"]), ("Connected", "v1"))

    def test_measures_and_error_events_are_saved_as_read(self):
        cursor = self.run_batch()
        self.assertEqual(self.saved(cursor, "process_save_measure"), [MEASURE])
        self.assertEqual(self.saved(cursor, "process_save_error_event"), [ERROR_EVENT])

    def test_rules_version_follows_the_rule_files_but_not_line_endings(self):
        def version(text):
            with patch("pathlib.Path.read_bytes", return_value=text):
                return job.rules_version()

        self.assertRegex(job.rules_version(), "^[0-9a-f]{16}$")
        self.assertEqual(version(b"rule one\nrule two\n"), version(b"rule one\r\nrule two\r\n"))
        self.assertNotEqual(version(b"rule one\nrule two\n"), version(b"rule one\nrule three\n"))

    def test_a_clash_is_retried_and_other_errors_are_not(self):
        calls = []

        def clash():
            calls.append(1)
            if len(calls) < 3:
                raise job.psycopg.errors.SerializationFailure()
            return 7

        with patch("pipeline.job.time.sleep"):
            self.assertEqual(job.with_retries(clash), 7)
        self.assertEqual(len(calls), 3)
        with self.assertRaises(ValueError):
            job.with_retries(lambda: (_ for _ in ()).throw(ValueError()))

    def test_every_keeps_asking_for_a_full_retag_until_one_runs(self):
        # The first run finds another one busy and the second fails, so only the third clears --full.
        outcomes = [False, job.psycopg.OperationalError(), True, True]
        with patch("pipeline.job.run", side_effect=outcomes) as run, \
                patch("pipeline.job.time.sleep", side_effect=[None, None, None, Stop()]), \
                patch("sys.stderr"), self.assertRaises(Stop):
            job.main(["--every", "1", "--full"])
        self.assertEqual(run.call_args_list, [call(True, job.BATCH), call(True, job.BATCH),
                                              call(True, job.BATCH), call(False, job.BATCH)])


if __name__ == "__main__":
    unittest.main()
