// Tests for choices.js (run with `npm test`).
import { test } from "node:test";
import assert from "node:assert/strict";
import { listKey, usableDay } from "./choices.js";

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
