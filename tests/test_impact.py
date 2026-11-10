import os
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import django

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "backend.config")
django.setup()

from django.test import Client  # noqa: E402  (needs django.setup first)

from logic.rules import DEFINITIONS, NOT_FILTERS, SECTIONS, combine_sessions, groups, matches, summary, tags  # noqa: E402

START = datetime(2026, 10, 1, tzinfo=timezone.utc)
TOTALS = {"sessions": 0, "stats_only": 0, "streamed_seconds": 0, "low_fps_seconds": 0,
          "fps_sum": 0, "fps_valid": 0, "ready_p50": None, "ready_p90": None}


def session(**facts):
    return combine_sessions([[{"session_id": "a", "events": 1, **facts}]])[0]


def stored(tagged=None, listed=None, **totals):
    # What repository.batch returns for one /api/impact/ request.
    totals = [{**TOTALS, **totals}]
    reasons = [{"reason": row["why"], "sessions": 1} for row in listed or []]
    return {"tags": tagged or [], "totals": totals, "reasons": reasons,
            "before_tags": tagged or [], "before_totals": totals,
            "list": listed or [], "list_reasons": reasons,
            "measures": [{"measure": "latency", "average": 25.0, "readings": 60, "sessions": 3, "typical": 20.0,
                          "high_tenth": 40.0, "low_tenth": 10.0}], "before_measures": [],
            "trend": [], "error_reasons": []}


class RuleTests(unittest.TestCase):
    def test_session_crossing_midnight_counts_once(self):
        rows = combine_sessions([[{"session_id": "a", "events": 2, "streamed_seconds": 600}],
                                 [{"session_id": "a", "events": 1, "streamed_seconds": 1200}]])
        self.assertEqual(len(rows), 1)
        self.assertEqual((rows[0]["events"], rows[0]["streamed_seconds"]), (3, 1800))

    def test_stats_without_events_stay_out_of_session_counts(self):
        rows = combine_sessions([[{"session_id": "a", "events": 1, "batches": 1},
                                  {"session_id": "b", "events": 1},
                                  {"session_id": "c", "batches": 1, "streamed_seconds": 60}]])
        a, b, c = sorted(rows, key=lambda row: row["session_id"])
        self.assertEqual([matches(row, "all") for row in (a, b, c)], [True, True, False])
        self.assertTrue(matches(a, "measured"))
        self.assertTrue(matches(b, "missing_stats"))
        self.assertEqual(tags(c), ["stats_only"])

    def test_average_fps_divides_sums_by_reading_count(self):
        # One reading of 10 and nine of 20 average 19, not the 15 you get from averaging the days.
        rows = combine_sessions([[{"session_id": "a", "events": 1, "fps_sum": 10, "fps_valid": 1}],
                                 [{"session_id": "a", "events": 1, "fps_sum": 180, "fps_valid": 9}]])
        self.assertEqual(rows[0]["fps_mean"], 19)

    def test_idle_30_fps_is_not_below_30(self):
        idle = session(fps_sum=300, fps_valid=10)
        self.assertFalse(matches(idle, "low_fps"))
        self.assertFalse(matches(idle, "any_low_fps"))
        dip = session(fps_sum=580, fps_valid=10, low_fps_seconds=1)
        self.assertFalse(matches(dip, "low_fps"))
        self.assertTrue(matches(dip, "any_low_fps"))

    def test_failure_after_session_end_is_not_a_connection_failure(self):
        stale = session(failures_after_end=3)
        self.assertFalse(matches(stale, "failure"))
        self.assertTrue(matches(stale, "failure_after_end"))

    def test_attempt_without_success_is_never_connected_even_without_a_failure(self):
        self.assertTrue(matches(session(attempts=1), "no_success"))
        self.assertFalse(matches(session(attempts=1, last_success=START), "no_success"))
        self.assertFalse(matches(session(), "no_success"))

    def test_connected_without_stats_is_flagged_as_missing_time(self):
        self.assertTrue(matches(session(attempts=1, last_success=START), "connected_no_stats"))
        self.assertFalse(matches(session(attempts=1, last_success=START, batches=1), "connected_no_stats"))

    def test_time_to_first_frame_uses_the_first_success_and_real_values(self):
        rows = combine_sessions([
            [{"session_id": "a", "events": 1, "attempts": 1, "first_success": START + timedelta(hours=1),
              "last_success": START + timedelta(hours=1), "first_ready_ms": 30000}],
            [{"session_id": "a", "events": 1, "first_success": START,
              "last_success": START, "first_ready_ms": 9000}]])
        self.assertEqual(rows[0]["first_ready_ms"], 9000)

    def test_high_skipped_frames_needs_ten_percent_of_streamed_time(self):
        self.assertTrue(matches(session(streamed_seconds=100, high_skip_seconds=10), "high_skip"))
        self.assertFalse(matches(session(streamed_seconds=100, high_skip_seconds=9), "high_skip"))
        self.assertFalse(matches(session(), "high_skip"))

    def test_stream_drop_counts_sessions_that_lost_video(self):
        self.assertTrue(matches(session(attempts=1, stream_drops=2), "stream_drops"))
        self.assertFalse(matches(session(attempts=1), "stream_drops"))

    def test_why_names_the_last_step_reached(self):
        self.assertEqual(session(attempts=1, failures=1, last_failure=START,
                                 failure_detail="500 / Session / pre-connect")["why"],
                         "Failed: server error before connecting, at session setup (code 500)")
        self.assertEqual(session(attempts=1, webrtc_failures=1)["why"],
                         "No error reported: the video connection failed")
        self.assertEqual(session(attempts=1, host_connects=1, client_connects=1)["why"],
                         "No error reported: both joined but video never started")
        self.assertEqual(session(attempts=1, last_success=START)["why"], "Connected")

    def test_failure_detail_comes_from_the_latest_failure_day(self):
        rows = combine_sessions([
            [{"session_id": "a", "events": 1, "attempts": 1, "failures": 1,
              "last_failure": START, "failure_detail": "400 / Session / connecting"}],
            [{"session_id": "a", "events": 1, "failures": 1,
              "last_failure": START + timedelta(days=1), "failure_detail": "500 / Session / pre-connect"}]])
        self.assertEqual(rows[0]["why"],
                         "Failed: server error before connecting, at session setup (code 500)")

    def test_failure_then_success_then_failure_is_not_recovered(self):
        row = session(failures=2, last_failure=START + timedelta(minutes=2),
                      last_success=START + timedelta(minutes=1))
        self.assertTrue(matches(row, "no_later_success"))
        row["last_success"] = START + timedelta(minutes=3)
        self.assertTrue(matches(row, "later_success"))

    def test_streamed_time_counts_as_measured_without_a_batch_that_day(self):
        # A batch that started just before midnight still gives seconds to the next day.
        row = session(streamed_seconds=5)
        self.assertTrue(matches(row, "measured"))
        self.assertFalse(matches(row, "missing_stats"))

    def test_every_card_has_a_rule(self):
        self.assertEqual(set(groups(session())), set(DEFINITIONS))
        self.assertEqual(set(groups(session(events=0))), set(DEFINITIONS))

    def test_every_tag_sits_in_exactly_one_filter_section(self):
        # Every group is either a filter in exactly one section, or deliberately left out of the filters.
        placed = [tag for tags_in_section in SECTIONS.values() for tag in tags_in_section]
        self.assertEqual(len(placed), len(set(placed)))
        self.assertEqual(set(placed) | NOT_FILTERS, set(DEFINITIONS))
        self.assertFalse(set(placed) & NOT_FILTERS)

    def test_errors_become_type_and_stage_tags_across_days(self):
        rows = combine_sessions([
            [{"session_id": "a", "events": 1, "error_types": ["pipeline.connection.dropped"], "error_stages": ["Session"]}],
            [{"session_id": "a", "events": 1, "error_types": ["media.decode.error"], "error_stages": ["Input"]}]])
        found = tags(rows[0])
        for tag in ("error_dropped", "error_decode", "stage_session", "stage_input"):
            self.assertIn(tag, found)
        self.assertNotIn("stage_video", found)
        # Unknown names never become tags, so the list cannot grow on its own.
        odd = session(error_types=["something.new"], error_stages=["Somewhere"])
        self.assertFalse(any(tag.startswith(("error_", "stage_")) for tag in tags(odd)))

    def test_how_a_session_ended_is_its_own_tag(self):
        self.assertIn("ended_device_deleted", tags(session(ends=1, device_deleted_ends=1)))
        self.assertNotIn("no_end", tags(session(ends=1, device_deleted_ends=1)))
        self.assertIn("no_end", tags(session()))

    def test_tags_are_the_card_rules(self):
        found = tags(session(attempts=2, failures=1, last_failure=START, reconnects=1, owner_joins=1))
        for tag in ("tried", "failure", "no_later_success", "no_success", "repeated_attempts",
                    "missing_stats", "reconnected", "owner", "no_end"):
            self.assertIn(tag, found)
        self.assertNotIn("all", found)
        self.assertNotIn("connected", found)


class SummaryTests(unittest.TestCase):
    def test_low_fps_time_share_uses_streamed_time(self):
        result = summary({}, {**TOTALS, "sessions": 1, "streamed_seconds": 3600, "low_fps_seconds": 360})
        self.assertEqual(result["low_fps_hours"], 0.1)
        self.assertEqual(result["low_fps_time_share"], 10)

    def test_connection_rates_divide_by_sessions_that_tried(self):
        result = summary({"tried": 2, "no_success": 1}, {**TOTALS, "sessions": 4})
        self.assertEqual(result["groups"]["no_success"]["share"], 50)
        # No session sent readings, so there is no frame-rate share to show, not 0%.
        self.assertIsNone(result["groups"]["low_fps"]["share"])
        self.assertEqual(result["attempted"], 2)

    def test_each_share_is_out_of_the_sessions_it_can_apply_to(self):
        result = summary({"tried": 90, "connected": 80, "measured": 40, "low_fps": 10, "stream_drops": 8},
                         {**TOTALS, "sessions": 100})
        self.assertEqual(result["groups"]["low_fps"]["share"], 25)       # 10 of 40 that sent readings
        self.assertEqual(result["groups"]["stream_drops"]["share"], 10)  # 8 of 80 that connected
        self.assertEqual(result["groups"]["low_fps"]["base"], 40)

    def test_missing_stats_never_become_zero_fps(self):
        result = summary({}, {**TOTALS, "sessions": 1})
        self.assertIsNone(result["fps_mean"])
        self.assertIsNone(result["low_fps_time_share"])


class ImpactApiTests(unittest.TestCase):
    def test_low_fps_list_asks_for_the_worst_sessions_first(self):
        listed = [{"session_id": "b", "fps_mean": 5, "why": "Connected"}]
        with patch("database.repository.batch", return_value=stored(listed=listed)) as batch:
            params = {"start": "2026-10-01", "end": "2026-10-01", "category": "low_fps"}
            data = Client().get("/api/impact/", params).json()["sessions"]
        self.assertEqual(data["order"], "Lowest average FPS first")
        name, query = batch.call_args.args[0]["list"]
        self.assertEqual((name, query["category"], query["limit"], query["offset"], query["sort"]),
                         ("impact_list", "low_fps", 25, 0, ""))

    def test_changes_compare_like_with_like(self):
        # One day is compared with the same weekday a week earlier; a week or more with the days just before.
        for start, end, then in (("2026-10-08", "2026-10-08", ("2026-10-01", "2026-10-02")),
                                 ("2026-10-08", "2026-10-10", ("2026-10-01", "2026-10-04")),
                                 ("2026-10-08", "2026-10-21", ("2026-09-24", "2026-10-08"))):
            with patch("database.repository.batch", return_value=stored()) as batch:
                self.assertEqual(Client().get("/api/impact/", {"start": start, "end": end}).status_code, 200)
            _, query = batch.call_args.args[0]["before_totals"]
            self.assertEqual((str(query["start"])[:10], str(query["end"])[:10]), then)

    def test_a_list_sorts_by_a_known_column_only(self):
        with patch("database.repository.batch", return_value=stored()) as batch:
            params = {"start": "2026-10-01", "end": "2026-10-01", "category": "all", "sort": "wait", "order": "asc"}
            self.assertEqual(Client().get("/api/impact/", params).status_code, 200)
        _, query = batch.call_args.args[0]["list"]
        self.assertEqual((query["sort"], query["descending"]), ("wait", False))
        with patch("database.repository.batch") as batch:
            params = {"start": "2026-10-01", "end": "2026-10-01", "category": "all", "sort": "a.session_id; --"}
            self.assertEqual(Client().get("/api/impact/", params).status_code, 400)
            batch.assert_not_called()

    def test_card_count_matches_its_session_list(self):
        listed = [{"session_id": "a", "fps_mean": 20, "why": "Connected"}]
        tagged = [{"tag": "low_fps", "sessions": 1}, {"tag": "fps", "sessions": 2}]
        with patch("database.repository.batch", return_value=stored(tagged, listed, sessions=2)):
            params = {"start": "2026-10-01", "end": "2026-10-01", "category": "low_fps"}
            response = Client().get("/api/impact/", params)
        data = response.json()
        self.assertEqual(data["summary"]["groups"]["low_fps"]["count"], 1)
        self.assertEqual(data["sessions"]["total"], 1)
        self.assertEqual(data["sessions"]["items"][0]["session_id"], "a")
        # "Sessions with a frame rate" is a card but not a filter, so only the low-FPS filter is listed.
        self.assertEqual(data["facets"]["sections"], [{"title": "Stream quality", "tags": [
            {"key": "low_fps", "title": "Averaged below 30 FPS", "count": 1}]}])
        self.assertEqual(data["previous"]["sessions"], 2)  # the mock returns the same totals for the day before
        self.assertEqual(data["summary"]["measures"], {"latency": {
            "average": 25.0, "readings": 60, "sessions": 3, "typical": 20.0, "high_tenth": 40.0, "low_tenth": 10.0}})
        # A one-day view still gets 28 days of trend, with empty days filled in.
        self.assertEqual(len(data["trend"]), 28)
        self.assertEqual(data["trend"][-1]["day"], "2026-10-01")
        self.assertEqual(data["trend"][0]["sessions"], 0)
        self.assertEqual(response["Cache-Control"], "no-store")

    def test_filters_reach_every_query_and_bad_ones_never_do(self):
        with patch("database.repository.batch", return_value=stored()) as batch:
            params = {"start": "2026-10-01", "end": "2026-10-01", "filters": "no_success,owner",
                      "reason": "Connected"}
            self.assertEqual(Client().get("/api/impact/", params).status_code, 200)
        for name, query in batch.call_args.args[0].values():
            self.assertEqual((query["filters"], query["reason"], query["error_code"]),
                             (["no_success", "owner"], "Connected", ""))
        with patch("database.repository.batch") as batch:
            for bad in ({"filters": "all"}, {"filters": "x;DROP"}, {"reason": "x" * 201}):
                params = {"start": "2026-10-01", "end": "2026-10-01", **bad}
                self.assertEqual(Client().get("/api/impact/", params).status_code, 400)
            batch.assert_not_called()


if __name__ == "__main__":
    unittest.main()
