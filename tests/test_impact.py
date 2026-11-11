"""Tests for the rules (outcomes, tags, shares) and the main page's API."""
import unittest
from datetime import date, timedelta
from unittest.mock import patch

from helpers import START, session

from django.test import Client  # after helpers, which sets up Django

from api.impact import ERROR_KEYS, ORDER
from pipeline.rules import (
    DEFINITIONS, NOT_FILTERS, OF_ATTEMPTED, OF_CONNECTED, OF_MEASURED, OUTCOMES, SECTIONS, combine_sessions,
    error_words, groups, outcome, summary, tags)
from shared.db import QUERIES

# The totals row of a period with no sessions; each test overrides what it needs.
TOTALS = {"sessions": 0, "stats_only": 0, "streamed_seconds": 0, "low_fps_seconds": 0,
          "fps_sum": 0, "fps_valid": 0, "ready_p50": None, "ready_p90": None}
# One measurement row as impact_measures returns it.
MEASURE = {"average": 25.0, "readings": 60, "sessions": 3, "typical": 20.0, "high_tenth": 40.0, "low_tenth": 10.0}
# A one-day selection, the default for the API tests.
DAY = {"start": "2026-10-01", "end": "2026-10-01"}
OUTCOME_KEYS = [key for key, _, _ in OUTCOMES]
# A moment after START, for facts that must come in order.
LATER = START + timedelta(seconds=5)

# Every branch of outcome() and why(): the facts, the outcome they must give and the reason line.
CASES = [
    ("connected", dict(attempts=1, last_success=START), "outcome_connected", "Connected"),
    ("success without an attempt", dict(last_success=START), "outcome_connected", "Connected"),
    ("error, then connected", dict(attempts=2, failures=1, last_failure=START, last_success=LATER),
     "outcome_recovered", "Connected after an error"),
    ("connected, then a later try failed",
     dict(attempts=2, failures=1, last_success=START, last_failure=LATER, failure_detail="500 / Session / pre-connect"),
     "outcome_later_failed",
     "Connected, but a later try failed: server error before connecting, at session setup (code 500)"),
    ("success and error at the same moment", dict(attempts=1, failures=1, last_success=START, last_failure=START),
     "outcome_later_failed", "Connected, but a later try failed: an error with no code"),
    ("failed", dict(attempts=1, failures=1, last_failure=START, failure_detail="400 / JoinSession / connecting"),
     "outcome_failed", "Failed: request rejected while connecting, at joining the session (code 400)"),
    ("failure without an attempt", dict(failures=1, last_failure=START, failure_detail="500 / Session / pre-connect"),
     "outcome_failed", "Failed: server error before connecting, at session setup (code 500)"),
    ("never tried", dict(), "outcome_not_tried", "Never tried to connect"),
    ("only errors after the end", dict(failures_after_end=2), "outcome_not_tried", "Never tried to connect"),
    ("video connection failed", dict(attempts=1, webrtc_failures=1, host_connects=1, client_connects=1),
     "outcome_silent", "No failure report: the video connection failed"),
    ("neither joined", dict(attempts=1), "outcome_silent",
     "No failure report: neither the player nor the host joined"),
    ("host never joined", dict(attempts=1, client_connects=1), "outcome_silent",
     "No failure report: the host never joined"),
    ("player never joined", dict(attempts=1, host_connects=1), "outcome_silent",
     "No failure report: the player never joined"),
    ("both joined, no video", dict(attempts=1, host_connects=1, client_connects=1), "outcome_silent",
     "No failure report: both joined but video never started"),
    ("readings but no events", dict(events=0, batches=1), "stats_only", "Sent readings but no activity events"),
]


def stored(tagged=(), totals=None, before_tagged=(), before_totals=None, listed=(), list_reasons=None,
           measures=(), before_measures=()):
    # What db.batch returns for one /api/impact/ request; the earlier period has its own rows.
    reasons = list_reasons if list_reasons is not None else [{"reason": row["why"], "sessions": 1} for row in listed]
    return {"tags": list(tagged), "totals": [{**TOTALS, **(totals or {})}], "reasons": reasons,
            "before_tags": list(before_tagged), "before_totals": [{**TOTALS, **(before_totals or {})}],
            "measures": list(measures), "before_measures": list(before_measures),
            "list": list(listed), "list_reasons": reasons, "trend": [], "error_events": []}


def asked(batch, **params):
    # Calls /api/impact/ with the batch mocked and returns the response and the queries it asked for.
    response = Client().get("/api/impact/", {**DAY, **params})
    return response, batch.call_args.args[0] if batch.called else None


# The rules in pipeline/rules.py, run on made-up sessions built by helpers.session().
class RuleTests(unittest.TestCase):
    def test_every_connected_session_counts_as_tried(self):
        # A success with its attempt event lost still counts as a try, so connected never exceeds tried.
        found = tags(session(last_success=START))
        self.assertIn("connected", found)
        self.assertIn("tried", found)

    def test_session_crossing_midnight_counts_once(self):
        rows = combine_sessions([[{"session_id": "a", "events": 2, "streamed_seconds": 600}],
                                 [{"session_id": "a", "events": 1, "streamed_seconds": 1200}]])
        self.assertEqual(len(rows), 1)
        self.assertEqual((rows[0]["events"], rows[0]["streamed_seconds"]), (3, 1800))

    def test_stats_without_events_stay_out_of_session_counts(self):
        # a has events and readings, b only events, c only readings.
        rows = combine_sessions([[{"session_id": "a", "events": 1, "batches": 1},
                                  {"session_id": "b", "events": 1},
                                  {"session_id": "c", "batches": 1, "streamed_seconds": 60}]])
        a, b, c = sorted(rows, key=lambda row: row["session_id"])
        self.assertEqual([groups(row)["all"] for row in (a, b, c)], [True, True, False])
        self.assertTrue(groups(a)["measured"])
        self.assertTrue(groups(b)["missing_stats"])
        self.assertEqual(tags(c), ["stats_only"])

    def test_average_fps_divides_sums_by_reading_count(self):
        # One reading of 10 and nine of 20 average 19, not the 15 you get from averaging the days.
        rows = combine_sessions([[{"session_id": "a", "events": 1, "fps_sum": 10, "fps_valid": 1}],
                                 [{"session_id": "a", "events": 1, "fps_sum": 180, "fps_valid": 9}]])
        self.assertEqual(rows[0]["fps_mean"], 19)

    def test_idle_30_fps_is_not_below_30(self):
        # Exactly 30 FPS is an idle desktop, not low. One low second is a dip without a low average.
        idle = groups(session(fps_sum=300, fps_valid=10))
        self.assertFalse(idle["low_fps"])
        self.assertFalse(idle["any_low_fps"])
        dip = groups(session(fps_sum=580, fps_valid=10, low_fps_seconds=1))
        self.assertFalse(dip["low_fps"])
        self.assertTrue(dip["any_low_fps"])

    def test_failure_after_session_end_is_not_a_connection_failure(self):
        stale = groups(session(failures_after_end=3))
        self.assertFalse(stale["failure"])
        self.assertTrue(stale["failure_after_end"])
        # A session with a real error as well is not in the "only after it closed" group.
        self.assertFalse(groups(session(failures=1, failures_after_end=3, last_failure=START))["failure_after_end"])

    def test_attempt_without_success_is_never_connected_even_without_a_failure(self):
        self.assertTrue(groups(session(attempts=1))["no_success"])
        self.assertFalse(groups(session(attempts=1, last_success=START))["no_success"])
        self.assertFalse(groups(session())["no_success"])

    def test_a_connection_error_proves_an_attempt(self):
        # The attempt event can be lost; the error still shows the session tried and never connected.
        found = groups(session(failures=1, last_failure=START))
        self.assertTrue(found["tried"])
        self.assertTrue(found["no_success"])
        self.assertTrue(found["outcome_failed"])

    def test_connected_without_stats_is_flagged_as_missing_time(self):
        self.assertTrue(groups(session(attempts=1, last_success=START))["connected_no_stats"])
        self.assertFalse(groups(session(attempts=1, last_success=START, batches=1))["connected_no_stats"])

    def test_time_to_video_is_the_value_of_the_first_success(self):
        later_day = {"session_id": "a", "events": 1, "first_success": START + timedelta(days=1),
                     "last_success": START + timedelta(days=1), "first_ready_ms": 30000}
        first_day = {"session_id": "a", "events": 1, "first_success": START, "last_success": START,
                     "first_ready_ms": 9000}
        self.assertEqual(combine_sessions([[later_day], [first_day]])[0]["first_ready_ms"], 9000)
        # When the first success sent no time, the session has none, even if a later success sent one.
        silent_first = {**first_day, "first_ready_ms": None}
        self.assertIsNone(combine_sessions([[later_day], [silent_first]])[0]["first_ready_ms"])

    def test_high_skipped_frames_needs_ten_percent_of_streamed_time(self):
        self.assertTrue(groups(session(streamed_seconds=100, high_skip_seconds=10))["high_skip"])
        self.assertFalse(groups(session(streamed_seconds=100, high_skip_seconds=9))["high_skip"])
        self.assertFalse(groups(session())["high_skip"])

    def test_stream_drop_counts_sessions_that_lost_video(self):
        self.assertTrue(groups(session(attempts=1, stream_drops=2))["stream_drops"])
        self.assertFalse(groups(session(attempts=1))["stream_drops"])

    def test_each_branch_gives_its_outcome_and_reason(self):
        for name, facts, key, text in CASES:
            with self.subTest(name):
                row = session(**facts)
                self.assertEqual(outcome(row), key)
                self.assertEqual(row["why"], text)

    def test_every_session_with_events_has_exactly_one_outcome_tag(self):
        # The outcome bars add up to all sessions only if each session is in exactly one.
        for name, facts, key, _ in CASES:
            with self.subTest(name):
                found = [tag for tag in tags(session(**facts)) if tag in OUTCOME_KEYS]
                self.assertEqual(found, [] if key == "stats_only" else [key])

    def test_error_groups_agree_with_the_outcomes(self):
        # "Error, not connected after it" is exactly the two outcomes that end on an error,
        # and "Error, then connected" is exactly the recovered outcome.
        for name, facts, _, _ in CASES:
            with self.subTest(name):
                found = groups(session(**facts))
                self.assertEqual(found["no_later_success"], found["outcome_later_failed"] + found["outcome_failed"])
                self.assertEqual(found["later_success"], found["outcome_recovered"])

    def test_failure_detail_comes_from_the_latest_failure_day(self):
        rows = combine_sessions([
            [{"session_id": "a", "events": 1, "attempts": 1, "failures": 1,
              "last_failure": START, "failure_detail": "400 / Session / connecting"}],
            [{"session_id": "a", "events": 1, "failures": 1,
              "last_failure": START + timedelta(days=1), "failure_detail": "500 / Session / pre-connect"}]])
        self.assertEqual(rows[0]["why"],
                         "Failed: server error before connecting, at session setup (code 500)")

    def test_error_words_handle_missing_and_unknown_parts(self):
        self.assertEqual(error_words(None), "an error with no code")
        self.assertEqual(error_words(" /  / "), "an error with no code")
        # An unknown code, stage or phase is kept as sent.
        self.assertEqual(error_words("999 / Odd / later"), "error later, at Odd (code 999)")
        self.assertEqual(error_words(" /  / connecting"), "error while connecting")
        self.assertEqual(error_words(" / Session / "), "error, at session setup")

    def test_streamed_time_counts_as_measured_without_a_batch_that_day(self):
        # A batch that started just before midnight still gives seconds to the next day.
        found = groups(session(streamed_seconds=5))
        self.assertTrue(found["measured"])
        self.assertFalse(found["missing_stats"])

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

    def test_a_session_that_never_connected_gets_exactly_its_tags(self):
        # The full tag list, so a rule that starts tagging something new shows up here.
        found = tags(session(attempts=2, failures=1, last_failure=START, reconnects=1, owner_joins=1))
        self.assertEqual(set(found), {"tried", "failure", "no_later_success", "no_success", "repeated_attempts",
                                      "missing_stats", "reconnected", "owner", "no_end", "outcome_failed"})


class GuardTests(unittest.TestCase):
    # Lists that must stay in step with DEFINITIONS when a card is added or renamed.
    def test_every_card_has_a_rule(self):
        # Sessions with and without events both give an answer for every group.
        self.assertEqual(set(groups(session())), set(DEFINITIONS))
        self.assertEqual(set(groups(session(events=0))), set(DEFINITIONS))

    def test_every_tag_sits_in_exactly_one_filter_section(self):
        # Every group is either a filter in exactly one section, or deliberately left out of the filters.
        placed = [tag for tags_in_section in SECTIONS.values() for tag in tags_in_section]
        self.assertEqual(len(placed), len(set(placed)))
        self.assertEqual(set(placed) | NOT_FILTERS, set(DEFINITIONS))
        self.assertFalse(set(placed) & NOT_FILTERS)

    def test_share_bases_name_known_cards_once(self):
        # Each share base lists real groups, and no group is out of two bases at once.
        bases = (OF_ATTEMPTED, OF_CONNECTED, OF_MEASURED)
        for base in bases:
            self.assertLessEqual(base, set(DEFINITIONS))
        for i, first in enumerate(bases):
            for second in bases[i + 1:]:
                self.assertFalse(first & second)

    def test_list_orders_are_for_known_cards(self):
        self.assertLessEqual(set(ORDER), set(DEFINITIONS))

    def test_every_impact_report_applies_the_page_filters(self):
        # The filters are written once in api/sql/impact.sql and put into each report by shared/db.py.
        for name in ("impact_tags", "impact_totals", "impact_measures", "impact_trend", "impact_error_events",
                     "impact_list", "impact_reasons"):
            with self.subTest(name):
                self.assertNotIn("{selected}", QUERIES[name])
                self.assertIn(QUERIES["selected"], QUERIES[name])
                self.assertIn("x.after_end = (%(error_after_end)s = '1')", QUERIES[name])


# Card numbers and shares worked out from the query rows.
class SummaryTests(unittest.TestCase):
    def test_low_fps_time_share_uses_streamed_time(self):
        result = summary({}, {**TOTALS, "sessions": 1, "streamed_seconds": 3600, "low_fps_seconds": 360})
        self.assertEqual(result["low_fps_hours"], 0.1)
        self.assertEqual(result["low_fps_time_share"], 10)

    def test_connection_rates_divide_by_sessions_that_tried(self):
        result = summary({"tried": 2, "no_success": 1, "connected": 1}, {**TOTALS, "sessions": 4})
        self.assertEqual(result["groups"]["no_success"]["share"], 50)
        self.assertEqual(result["groups"]["connected"]["share"], 50)
        # No session sent readings, so there is no frame-rate share to show, not 0%.
        self.assertIsNone(result["groups"]["low_fps"]["share"])
        self.assertEqual(result["attempted"], 2)

    def test_each_share_is_out_of_the_sessions_it_can_apply_to(self):
        result = summary({"tried": 90, "connected": 80, "measured": 40, "low_fps": 10, "stream_drops": 8,
                          "ready": 60}, {**TOTALS, "sessions": 100})
        self.assertEqual(result["groups"]["low_fps"]["share"], 25)       # 10 of 40 that sent readings
        self.assertEqual(result["groups"]["stream_drops"]["share"], 10)  # 8 of 80 that connected
        self.assertEqual(result["groups"]["ready"]["share"], 75)         # 60 of 80 that connected
        self.assertEqual(result["groups"]["low_fps"]["base"], 40)

    def test_missing_stats_never_become_zero_fps(self):
        result = summary({}, {**TOTALS, "sessions": 1})
        self.assertIsNone(result["fps_mean"])
        self.assertIsNone(result["low_fps_time_share"])


# /api/impact/ with db.batch mocked: which queries it asks for and what it returns.
@patch("shared.db.batch")
class ImpactApiTests(unittest.TestCase):
    def test_low_fps_list_asks_for_the_worst_sessions_first(self, batch):
        # The card's own order is named for the page, and the list asks for the first page of 25.
        batch.return_value = stored(listed=[{"session_id": "b", "fps_mean": 5, "why": "Connected"}])
        response, queries = asked(batch, category="low_fps")
        self.assertEqual(response.json()["sessions"]["order"], "Lowest average FPS first")
        name, query = queries["list"]
        self.assertEqual((name, query["category"], query["limit"], query["offset"], query["sort"]),
                         ("impact_list", "low_fps", 25, 0, ""))

    def test_list_total_is_the_sum_of_its_reasons(self, batch):
        listed = [{"session_id": "a", "fps_mean": 20, "why": "Connected"}]
        batch.return_value = stored(listed=listed, list_reasons=[{"reason": "Connected", "sessions": 3},
                                                                 {"reason": "Failed: x", "sessions": 2}])
        data = asked(batch, category="low_fps")[0].json()["sessions"]
        self.assertEqual(data["total"], 5)
        self.assertEqual(data["items"], listed)
        self.assertEqual(data["reasons"], [["Connected", 3], ["Failed: x", 2]])

    def test_filter_panel_lists_only_filters_that_have_sessions(self, batch):
        # "Sessions with a frame rate" is a card but not a filter, so only the low-FPS filter is listed.
        batch.return_value = stored(tagged=[{"tag": "low_fps", "sessions": 1}, {"tag": "fps", "sessions": 2}],
                                    totals={"sessions": 2})
        data = asked(batch)[0].json()
        self.assertEqual(data["summary"]["groups"]["low_fps"]["count"], 1)
        self.assertEqual(data["facets"]["sections"], [{"title": "Stream quality", "tags": [
            {"key": "low_fps", "title": "Averaged below 30 FPS", "count": 1}]}])

    def test_measures_are_passed_through_by_name(self, batch):
        batch.return_value = stored(measures=[{"measure": "latency", **MEASURE}])
        self.assertEqual(asked(batch)[0].json()["summary"]["measures"], {"latency": MEASURE})

    def test_responses_are_never_cached(self, batch):
        batch.return_value = stored()
        self.assertEqual(asked(batch)[0]["Cache-Control"], "no-store")

    def test_previous_comes_from_the_earlier_period_rows(self, batch):
        # The earlier period's numbers come only from its own rows, never from the selected period's.
        earlier = {**MEASURE, "average": 99.0}
        batch.return_value = stored(tagged=[{"tag": "low_fps", "sessions": 1}], totals={"sessions": 2},
                                    measures=[{"measure": "latency", **MEASURE}],
                                    before_tagged=[{"tag": "low_fps", "sessions": 5}], before_totals={"sessions": 7},
                                    before_measures=[{"measure": "latency", **earlier}])
        data = asked(batch)[0].json()
        self.assertEqual((data["summary"]["sessions"], data["previous"]["sessions"]), (2, 7))
        self.assertEqual(data["previous"]["groups"]["low_fps"]["count"], 5)
        self.assertEqual(data["previous"]["measures"], {"latency": earlier})

    def test_no_previous_when_the_earlier_period_had_no_sessions(self, batch):
        batch.return_value = stored(totals={"sessions": 2})
        self.assertIsNone(asked(batch)[0].json()["previous"])

    def test_changes_compare_like_with_like(self, batch):
        # One day is compared with the same weekday a week earlier; a week or more with the days just before.
        batch.return_value = stored()
        for start, end, then in (("2026-10-08", "2026-10-08", ("2026-10-01", "2026-10-02")),
                                 ("2026-10-08", "2026-10-10", ("2026-10-01", "2026-10-04")),
                                 ("2026-10-08", "2026-10-21", ("2026-09-24", "2026-10-08"))):
            response, queries = asked(batch, start=start, end=end)
            self.assertEqual(response.status_code, 200)
            for key in ("before_tags", "before_totals", "before_measures"):
                _, query = queries[key]
                self.assertEqual((str(query["start"])[:10], str(query["end"])[:10]), then)

    def test_trend_covers_at_least_28_days_ending_on_the_last_day(self, batch):
        batch.return_value = stored()
        response, queries = asked(batch)
        self.assertEqual(str(queries["trend"][1]["start"])[:10], "2026-09-04")
        trend = response.json()["trend"]
        self.assertEqual((len(trend), trend[0]["day"], trend[-1]["day"]), (28, "2026-09-04", "2026-10-01"))
        self.assertEqual(trend[0]["sessions"], 0)  # days without sessions are filled in
        # A longer selection starts its trend on its own first day.
        _, queries = asked(batch, start="2026-08-01", end="2026-10-01")
        self.assertEqual(queries["trend"][1]["start"].date(), date(2026, 8, 1))

    def test_error_events_are_passed_through(self, batch):
        rows = [{"code": "500", "event": "pipeline.connect.failure", "stage": "Session", "phase": "pre-connect",
                 "reason": "Made-up", "after_end": False, "sessions": 2, "events": 3}]
        batch.return_value = {**stored(), "error_events": rows}
        response, queries = asked(batch)
        self.assertEqual(queries["error_events"][0], "impact_error_events")
        self.assertEqual(response.json()["error_events"], rows)

    def test_the_error_filter_reaches_every_query(self, batch):
        # Connection state errors carry no code, so an error is picked by its event, stage, phase and reason.
        picked = {"error_code": "", "error_event": "webrtc.connection.state", "error_stage": "WebRTC",
                  "error_phase": "connecting", "error_reason": "connected → failed", "error_after_end": "0"}
        batch.return_value = stored()
        response, queries = asked(batch, category="all", **picked)
        self.assertEqual(response.status_code, 200)
        for key, (_, query) in queries.items():
            with self.subTest(key):
                self.assertEqual({name: query[name] for name in ERROR_KEYS}, picked)

    def test_a_broken_error_filter_never_reaches_the_database(self, batch):
        # A code or reason without an event, an odd after_end or over-long text is a broken link.
        for bad in ({"error_code": "500"}, {"error_reason": "x"}, {"error_after_end": "1"},
                    {"error_event": "x", "error_after_end": "yes"}, {"error_event": "x" * 2001},
                    {"error_event": "x", "error_reason": "x" * 2001}):
            with self.subTest(bad):
                self.assertEqual(asked(batch, **bad)[0].status_code, 400)
        batch.assert_not_called()

    def test_a_list_sorts_by_a_known_column_only(self, batch):
        # A sort is a fixed column name, so text such as SQL can never reach the query.
        batch.return_value = stored()
        response, queries = asked(batch, category="all", sort="wait", order="asc")
        self.assertEqual(response.status_code, 200)
        _, query = queries["list"]
        self.assertEqual((query["sort"], query["descending"]), ("wait", False))
        batch.reset_mock()
        self.assertEqual(asked(batch, category="all", sort="a.session_id; --")[0].status_code, 400)
        batch.assert_not_called()

    def test_filters_reach_every_query_and_bad_ones_never_do(self, batch):
        # Filters reach every query; "all" and unknown or over-long ones are rejected before any query.
        batch.return_value = stored()
        response, queries = asked(batch, filters="no_success,owner", reason="Connected")
        self.assertEqual(response.status_code, 200)
        for key, (_, query) in queries.items():
            with self.subTest(key):
                self.assertEqual((query["filters"], query["reason"]), (["no_success", "owner"], "Connected"))
        batch.reset_mock()
        for bad in ({"filters": "all"}, {"filters": "x;DROP"}, {"reason": "x" * 2001}):
            self.assertEqual(asked(batch, **bad)[0].status_code, 400)
        batch.assert_not_called()

    def test_a_list_page_goes_no_further_than_10000_sessions(self, batch):
        # Page 400 is the last one that can exist; a later page is a broken link and never reaches the database.
        batch.return_value = stored()
        response, queries = asked(batch, category="all", page="400")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(queries["list"][1]["offset"], 9975)
        # The answer carries the limit, so the page's pager never offers a page past it.
        self.assertEqual(response.json()["sessions"]["max_pages"], 400)
        batch.reset_mock()
        response = asked(batch, category="all", page="401")[0]
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["error"], "Something in this page's address isn't valid. Use Reset view.")
        batch.assert_not_called()

    def test_a_bad_search_gets_its_own_message(self, batch):
        # A search mistake gets its own message, since it was typed, not from a broken link.
        response = asked(batch, category="all", search="drop table")[0]
        self.assertEqual(response.status_code, 400)
        self.assertTrue(response.json()["error"].startswith("Search:"))
        batch.assert_not_called()

    def test_a_list_only_request_runs_just_the_lists_two_reports(self, batch):
        # Paging or sorting an open card asks again for its list alone, with exactly the queries
        # the full request would have run for it, and answers with nothing but the list.
        listed = [{"session_id": "a", "fps_mean": 20, "why": "Connected"}]
        batch.return_value = stored(listed=listed)
        picked = {"category": "low_fps", "page": "3", "sort": "wait", "order": "asc", "search": "ab",
                  "filters": "owner", "error_event": "ice.candidate.error"}
        full, full_queries = asked(batch, **picked)
        response, queries = asked(batch, only="list", **picked)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(queries, {key: full_queries[key] for key in ("list", "list_reasons")})
        self.assertEqual(response.json(), {"sessions": full.json()["sessions"]})
        self.assertEqual(response["Cache-Control"], "no-store")

    def test_a_list_only_request_needs_a_card_and_a_known_part(self, batch):
        # A list-only request with no open card, an unknown part or a page past the limit is a broken link.
        for bad in ({"only": "list"}, {"only": "summary", "category": "all"},
                    {"only": "list", "category": "all", "page": "401"}):
            with self.subTest(bad):
                self.assertEqual(asked(batch, **bad)[0].status_code, 400)
        batch.assert_not_called()


if __name__ == "__main__":
    unittest.main()
