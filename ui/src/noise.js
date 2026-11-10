// How big a change must be before it is more than everyday noise. Each function returns
// the largest gap that still counts as "no change"; the page only flags gaps above it.

// How far apart two shares must be before the gap is more than chance, at 99% confidence
// (a two-proportion test). Shares are in percent; n is how many sessions each is out of.
export function shareNoise(p1, n1, p2, n2) {
  const p = (p1 * n1 + p2 * n2) / 100 / (n1 + n2);
  return 2.58 * Math.sqrt(p * (1 - p) * (1 / n1 + 1 / n2)) * 100;
}

// Fewer sessions than this on either side and a share is not compared at all.
export const MIN_SESSIONS = 100;

// Counts such as sessions per period: the normal spread of a count is about its square root.
export const countNoise = (a, b) => 2.58 * Math.sqrt(a + b);

// Everyday ups and downs of a daily number, from its last four weeks (the moving-range method),
// scaled to the length of the period being compared. Under 8 days is too little history to judge.
export function dailyNoise(trend, field, days) {
  const values = trend
    .map((day) => day[field])
    .filter((value) => value != null);
  if (values.length < 8) return 0;
  const ranges = values.slice(1).map((value, i) => Math.abs(value - values[i]));
  const spread =
    ranges.reduce((sum, range) => sum + range, 0) / ranges.length / 1.128;
  return 2.58 * spread * Math.sqrt(2 / days);
}

// Network numbers have no daily history yet, so a change under 10% is treated as noise.
export const RELATIVE_NOISE = 0.1;
