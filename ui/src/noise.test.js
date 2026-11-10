// Tests for noise.js (run with `npm test`).
import { test } from "node:test";
import assert from "node:assert/strict";
import { MIN_SESSIONS, countNoise, dailyNoise, shareNoise } from "./noise.js";

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
  assert.ok(Math.abs(oneDay - 2.58 * (2 / 1.128) * Math.sqrt(2)) < 1e-9);
  assert.ok(dailyNoise(trend, "value", 7) < oneDay);
});
