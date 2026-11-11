"""Tests for the batch job: what one batch saves, the rules version, retries, the
--every loop, the run lock and the guards against bad rows and stuck queries."""
import io
import unittest
from datetime import date, timedelta
from unittest.mock import MagicMock, call, patch

from helpers import SESSION_ID, START

from pipeline import job
from shared import db
from shared.db import QUERIES

# One measurement row and one error row, as the job's read queries would return them.
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


# The job with every query mocked: what one batch saves, the rules version, retries and --every.
class ProcessorTests(unittest.TestCase):
    def run_batch(self):
        # Runs one batch against a mocked connection and returns the cursor that recorded its writes.
        connection = MagicMock()
        cursor = connection.cursor.return_value.__enter__.return_value
        with patch("pipeline.job.read", side_effect=lambda _, name, params=None: REPORTS[name]):
            job.process_batch(connection, [SESSION_ID], "v1")
        return cursor

    def saved(self, cursor, name):
        # The rows one save statement was given, found by the statement itself, not by its position.
        return next(c.args[1] for c in cursor.executemany.call_args_list if c.args[0] == QUERIES[name])

    def test_a_batch_leaves_the_queue_and_replaces_everything_it_stored(self):
        # The queue entry and every old row are removed first, for this batch's sessions only.
        cursor = self.run_batch()
        statements = [c.args[0] for c in cursor.execute.call_args_list]
        self.assertEqual(statements, [QUERIES[name] for name in (
            "process_dequeue", "process_clear_days", "process_clear_sessions", "process_clear_measures",
            "process_clear_error_events")])
        for c in cursor.execute.call_args_list:
            self.assertEqual(c.args[1], {"ids": [SESSION_ID]})

    def test_one_session_row_and_one_row_per_day(self):
        # Two days of events become two day rows but one session row, with their numbers added.
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
        # Any change to a rule file retags every session, but a checkout's line endings must not.
        def version(text):
            with patch("pathlib.Path.read_bytes", return_value=text):
                return job.rules_version()

        self.assertRegex(job.rules_version(), "^[0-9a-f]{16}$")
        self.assertEqual(version(b"rule one\nrule two\n"), version(b"rule one\r\nrule two\r\n"))
        self.assertNotEqual(version(b"rule one\nrule two\n"), version(b"rule one\nrule three\n"))

    def test_a_clash_is_retried_and_other_errors_are_not(self):
        # A clash between transactions is retried; any other error stops the job at once.
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


# A whole run() with the database mocked: who holds the lock, and what is freed when.
class LockTests(unittest.TestCase):
    PENDING = {"events_until": None, "stats_until": None, "rules_version": "v1"}

    def run_job(self, refreshed=True, broken=False):
        # One batch of one session. Returns run()'s result (or the error it raised), every read and its
        # params, the run's connection and the fresh one opened after it broke.
        connection, fresh = MagicMock(), MagicMock()
        for c in (connection, fresh):
            c.__enter__.return_value = c
        if broken:
            connection.execute.side_effect = job.psycopg.OperationalError()
        replies = {"process_lock": [[{"name": "sessions"}]],
                   "process_state": [[self.PENDING], [self.PENDING]],
                   "process_next": [[{"session_id": SESSION_ID}], [{"session_id": SESSION_ID}], []],
                   "process_lock_refresh": [[{"name": "sessions"}] if refreshed else []]}
        reads = []

        def fake_read(_, name, params=None):
            reads.append((name, params))
            return replies[name].pop(0)

        with patch("shared.db.connect", side_effect=[connection, fresh]), \
                patch("pipeline.job.create_tables"), patch("pipeline.job.VERSION", "v1"), \
                patch("pipeline.job.read", side_effect=fake_read), \
                patch("pipeline.job.process_batch",
                      side_effect=job.psycopg.OperationalError() if broken else [1]), \
                patch("sys.stdout"), patch("sys.stderr"):
            try:
                result = job.run(False, job.BATCH)
            except job.psycopg.Error as error:
                result = error
        return result, dict(reads), connection, fresh

    def test_the_lock_is_taken_refreshed_and_freed_with_the_runs_own_token(self):
        result, reads, connection, _ = self.run_job()
        self.assertTrue(result)
        token = reads["process_lock"]["token"]
        self.assertRegex(token, "^[0-9a-f]{32}$")
        self.assertEqual(reads["process_lock_refresh"], {"token": token})
        self.assertIn(call(QUERIES["process_unlock"], {"token": token}), connection.execute.call_args_list)
        # Refreshing and freeing touch only the row with this token.
        for name in ("process_lock_refresh", "process_unlock"):
            self.assertIn("token = %(token)s", QUERIES[name])
        self.assertIn("token = %(token)s", QUERIES["process_lock"])

    def test_a_run_whose_lock_was_taken_over_stops_without_saving(self):
        # Another run now holds the lock: this one neither saves its point nor frees that run's lock.
        result, reads, connection, _ = self.run_job(refreshed=False)
        self.assertFalse(result)
        statements = [c.args[0] for c in connection.execute.call_args_list]
        self.assertNotIn(QUERIES["process_save_state"], statements)
        self.assertEqual(connection.execute.call_args_list[-1],
                         call(QUERIES["process_unlock"], {"token": reads["process_lock"]["token"]}))

    def test_the_lock_is_freed_on_a_fresh_connection_when_the_runs_broke(self):
        result, reads, _, fresh = self.run_job(broken=True)
        self.assertIsInstance(result, job.psycopg.OperationalError)
        fresh.execute.assert_called_once_with(QUERIES["process_unlock"], {"token": reads["process_lock"]["token"]})


# A run when nothing new has arrived: it must stop at once instead of retagging the last day again.
class IdleTests(unittest.TestCase):
    MARKS = {"events_until": START, "stats_until": START}

    def run_job(self, marks=None, done_version="v1", full=False):
        # One run with an empty queue and the last finished run saved at MARKS. Returns run()'s result,
        # the statements it executed and what it printed.
        connection = MagicMock()
        connection.__enter__.return_value = connection
        state = {"sessions": {**self.MARKS, "rules_version": done_version},
                 "pending": {**self.MARKS, "rules_version": "v1"}}
        replies = {"process_lock": [{"name": "sessions"}], "process_next": [],
                   "process_marks": [marks or self.MARKS]}

        def fake_read(_, name, params=None):
            return [state[params["name"]]] if name == "process_state" else replies[name]

        with patch("shared.db.connect", return_value=connection), \
                patch("pipeline.job.create_tables"), patch("pipeline.job.VERSION", "v1"), \
                patch("pipeline.job.read", side_effect=fake_read), \
                patch("pipeline.job.process_batch") as process_batch, \
                patch("sys.stdout", new_callable=io.StringIO) as out:
            result = job.run(full, job.BATCH)
        process_batch.assert_not_called()
        return result, [c.args[0] for c in connection.execute.call_args_list], out.getvalue()

    def test_a_run_with_nothing_new_queues_and_saves_nothing(self):
        # Same marks, same rules, empty queue: no sessions queued, no state saved, the lock still freed.
        result, statements, printed = self.run_job()
        self.assertTrue(result)
        self.assertNotIn(QUERIES["process_queue_changed"], statements)
        self.assertNotIn(QUERIES["process_save_state"], statements)
        self.assertEqual(statements[-1], QUERIES["process_unlock"])
        self.assertIn("Nothing new", printed)

    def test_new_data_new_rules_or_full_still_fill_the_queue(self):
        moved = {**self.MARKS, "stats_until": START + timedelta(minutes=1)}
        for name, kwargs in (("new data", {"marks": moved}), ("new rules", {"done_version": "v0"}),
                             ("--full", {"full": True})):
            with self.subTest(name):
                result, statements, printed = self.run_job(**kwargs)
                self.assertTrue(result)
                self.assertIn(QUERIES["process_queue_changed"], statements)
                self.assertNotIn("Nothing new", printed)

    def test_sessions_left_in_the_queue_are_never_skipped(self):
        # Even with nothing new, a queue that still holds sessions is filled and worked through.
        connection = MagicMock()
        replies = {"process_marks": [self.MARKS], "process_state": [{**self.MARKS, "rules_version": "v1"}]}
        with patch("pipeline.job.read", side_effect=lambda _, name, params=None: replies[name]):
            self.assertTrue(job.fill_queue(connection, False, "v1", queued=True))
        self.assertIn(QUERIES["process_queue_changed"], [c.args[0] for c in connection.execute.call_args_list])


# The SQL and connection settings that keep one bad row or one stuck query from stopping the job.
def flat(text):
    # The SQL with every run of spaces and line breaks made one space, so reformatting a query
    # doesn't break the checks below.
    return " ".join(text.split())


class SafetyTests(unittest.TestCase):
    def test_json_is_only_unpacked_when_it_has_the_right_shape(self):
        # jsonb_array_length fails on a non-array and jsonb_each on a non-object, so both are only
        # given a value already checked, whatever order the database runs the WHERE in.
        guarded_length = ("CASE WHEN jsonb_typeof(s.samples->'ts') = 'array'\n"
                          "        THEN jsonb_array_length(s.samples->'ts') ELSE 0 END - 1")
        for name in ("process_seconds", "process_measures"):
            with self.subTest(name):
                self.assertIn(flat(guarded_length), flat(QUERIES[name]))
                self.assertEqual(QUERIES[name].count("jsonb_array_length("), 1)
        self.assertIn(flat("jsonb_each( CASE WHEN jsonb_typeof(s.samples) = 'object' THEN s.samples ELSE '{}'::JSONB END)"),
                      flat(QUERIES["process_measures"]))
        self.assertEqual(QUERIES["process_measures"].count("jsonb_each("), 1)

    def test_the_events_mark_never_passes_now(self):
        # One event stamped in the future must not push the saved point ahead of real time,
        # and an empty table still gives no mark.
        self.assertIn("FROM session_telemetry_events WHERE recorded_at <= now()", flat(QUERIES["process_marks"]))
        self.assertNotIn("LEAST", QUERIES["process_marks"])

    def test_pipeline_queries_have_a_finite_time_limit(self):
        # Generous for the job, short for pages, but never unlimited.
        for write, limit in ((True, "1800s"), (False, "180s")):
            with self.subTest(write=write), patch("shared.db.psycopg.connect") as connect:
                db.connect(write=write)
                self.assertIn(call(f"SET statement_timeout = '{limit}'"),
                              connect.return_value.execute.call_args_list)


if __name__ == "__main__":
    unittest.main()
