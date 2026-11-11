// Tests for noise.js (run with `npm test`).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MIN_SESSIONS,
  countNoise,
  dailyNoise,
  listKey,
  shareNoise,
  usableDay,
} from "./helpers.js";

// A gap counts as a change only when it is bigger than the noise.
const changed = (a, b, noise) => Math.abs(a - b) > noise;

test("shareNoise: equal shares are no change", () => {
  assert.equal(changed(10, 10, shareNoise(10, 1000, 10, 1000)), false);
});

test("shareNoise: 10% to 20% of 1,000 sessions each is a change", () => {
  assert.equal(changed(10, 20, shareNoise(10, 1000, 20, 1000)), true);
});

test("shareNoise: the same gap on too few sessions is not", () => {
  assert.ok(50 < MIN_SESSIONS);
  assert.equal(changed(10, 20, shareNoise(10, 50, 20, 50)), false);
});

test("countNoise: a 5% wobble in 1,000 sessions is no change", () => {
  assert.equal(changed(1000, 1050, countNoise(1000, 1050)), false);
});

test("countNoise: 1,000 to 1,300 sessions is a change", () => {
  assert.equal(changed(1000, 1300, countNoise(1000, 1300)), true);
});

// Builds a trend from plain numbers, one day each, under the field name "value".
const days = (values) => values.map((value) => ({ value }));

test("dailyNoise: under 8 days of history gives 0", () => {
  assert.equal(dailyNoise(days([1, 2, 3, 4, 5, 6, 7]), "value", 1), 0);
  // Days with no value don't count towards the 8.
  assert.equal(
    dailyNoise(days([1, 2, 3, 4, 5, 6, 7, null, null]), "value", 1),
    0,
  );
});

test("dailyNoise: a steady number has no noise", () => {
  assert.equal(dailyNoise(days(Array(28).fill(5)), "value", 1), 0);
});

test("dailyNoise: a number that jumps around has noise, less over longer periods", () => {
  const trend = days(Array.from({ length: 28 }, (_, i) => (i % 2 ? 12 : 10)));
  const oneDay = dailyNoise(trend, "value", 1);
  // Every day moves by 2, so one day's spread is 2 / 1.128; one day against one day
  // multiplies it by the root of 2.
  assert.ok(Math.abs(oneDay - 2.58 * (2 / 1.128) * Math.sqrt(2)) < 1e-9);
  assert.ok(dailyNoise(trend, "value", 7) < oneDay);
});

// Tests for choices.js (run with `npm test`).
// The address bar with a card open on page 2 of a filtered, error-picked list.
const open = {
  start: "2026-10-16",
  end: "2026-10-16",
  card: "no_success",
  filters: "failure",
  reason: "Connected",
  error_event: "pipeline.connect.failure",
  error_code: "500",
  error_after_end: "0",
};

test("listKey: opening or closing a session is the same list", () => {
  assert.equal(listKey({ ...open, session: "a".repeat(36) }), listKey(open));
});

test("listKey: another card is another list", () => {
  assert.notEqual(listKey({ ...open, card: "all" }), listKey(open));
});

test("listKey: other filters, reason or error are another list", () => {
  assert.notEqual(listKey({ ...open, filters: "" }), listKey(open));
  assert.notEqual(listKey({ ...open, reason: "" }), listKey(open));
  assert.notEqual(listKey({ ...open, error_code: "" }), listKey(open));
  assert.notEqual(listKey({ ...open, error_after_end: "1" }), listKey(open));
});

test("listKey: a missing choice is the same as an empty one", () => {
  assert.equal(listKey({ card: "all" }), listKey({ card: "all", reason: "" }));
});

const range = { start: "2026-08-03", end: "2026-10-17" };

test("usableDay: a day inside the stored range is used", () => {
  assert.equal(usableDay("2026-10-16", range), true);
  assert.equal(usableDay("2026-08-03", range), true);
  assert.equal(usableDay("2026-10-17", range), true);
});

test("usableDay: a year still being typed is not", () => {
  for (const day of ["0002-12-10", "0020-12-10", "0202-12-10"])
    assert.equal(usableDay(day, range), false, day);
});

test("usableDay: days outside the stored range are not", () => {
  assert.equal(usableDay("2026-08-02", range), false);
  assert.equal(usableDay("2026-12-10", range), false);
});

test("usableDay: an empty, malformed or impossible day is not", () => {
  for (const day of ["", "2026-9-01", "2026-02-30", "garbage", undefined])
    assert.equal(
      usableDay(day, { start: "2026-01-01", end: "2026-12-31" }),
      false,
      day,
    );
});

test("usableDay: a range given as timestamps is read by its dates", () => {
  const stamps = { start: "2026-08-03T10:00:00Z", end: "2026-10-17T09:00:00Z" };
  assert.equal(usableDay("2026-08-03", stamps), true);
  assert.equal(usableDay("2026-10-17", stamps), true);
});
