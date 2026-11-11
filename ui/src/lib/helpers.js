// The page's choices live in the address bar, so Back works and a copied link opens the same view.

export function readUrl() {
  return Object.fromEntries(new URLSearchParams(window.location.search));
}

// Sets or clears the given keys; an empty value removes its key, so links stay short.
// With `replace`, the current history entry is overwritten instead of adding a new one,
// so the first write after the page opens doesn't leave an extra step for Back.
export function writeUrl(changes, replace = false) {
  const params = new URLSearchParams(window.location.search);
  for (const [key, value] of Object.entries(changes)) {
    if (value) params.set(key, value);
    else params.delete(key);
  }
  const query = params.toString() ? "?" + params : "";
  // Nothing changed: add no history entry, so Back never lands on the same view twice.
  if (query === window.location.search) return;
  const address = window.location.pathname + query;
  if (replace) window.history.replaceState(null, "", address);
  else window.history.pushState(null, "", address);
}

// Plain checks on the page's choices: which address-bar values make a different session list,
// and whether a typed day can be shown. Kept free of React so `npm test` can run them.
// The address-bar values that decide which sessions the drawer lists. The open session and
// the dates are not among them: a session opens over the list, and new dates reset the list
// on their own. A missing value counts as empty, as the address bar drops empty values.
const LIST_KEYS = [
  "card",
  "filters",
  "reason",
  "error_code",
  "error_event",
  "error_stage",
  "error_phase",
  "error_reason",
  "error_after_end",
];
export const listKey = (params) =>
  JSON.stringify(LIST_KEYS.map((key) => params[key] || ""));

// A real day as YYYY-MM-DD. A real date reads back the same; 2026-02-30 would come back as
// 2026-03-02.
export const realDay = (value) =>
  /^\d{4}-\d{2}-\d{2}$/.test(value || "") &&
  new Date(value + "T00:00:00Z").toISOString().slice(0, 10) === value;

// True for a whole day inside the stored range. A date box reports every keystroke, so while a
// year is typed it passes through 0002, 0020 and 0202; only a day with data is worth asking for.
export const usableDay = (value, range) =>
  realDay(value) &&
  value >= range.start.slice(0, 10) &&
  value <= range.end.slice(0, 10);

// How big a change must be before it is more than everyday noise. Each function returns
// the largest gap that still counts as "no change"; the page only flags gaps above it.
// How far apart two shares must be before the gap is more than chance, at 99% confidence
// (a two-proportion test). Shares are in percent; n is how many sessions each is out of.
export function shareNoise(p1, n1, p2, n2) {
  // Assume nothing changed: both periods share one rate, worked out from all their sessions.
  const p = (p1 * n1 + p2 * n2) / 100 / (n1 + n2);
  // How much the gap between two samples of that rate normally wobbles, times 2.58,
  // the multiplier for 99% confidence; then back to percent.
  return 2.58 * Math.sqrt(p * (1 - p) * (1 / n1 + 1 / n2)) * 100;
}

// Fewer sessions than this on either side and a share is not compared at all.
export const MIN_SESSIONS = 100;

// Counts such as sessions per period: the normal spread of a count is about its square root,
// so the gap between two counts spreads by the root of their sum. 2.58 is again 99%.
export const countNoise = (a, b) => 2.58 * Math.sqrt(a + b);

// Everyday ups and downs of a daily number, from its last four weeks (the moving-range method),
// scaled to the length of the period being compared. Under 8 days is too little history to judge.
export function dailyNoise(trend, field, days) {
  // Days with no value are skipped rather than counted as zero.
  const values = trend
    .map((day) => day[field])
    .filter((value) => value != null);
  if (values.length < 8) return 0;
  // How far the number moved from each day to the next.
  const ranges = values.slice(1).map((value, i) => Math.abs(value - values[i]));
  // The average move, divided by 1.128 (the standard factor for moves between pairs),
  // estimates the normal spread of a single day.
  const spread =
    ranges.reduce((sum, range) => sum + range, 0) / ranges.length / 1.128;
  // Two periods of `days` days each: averaging over more days evens out the wobble,
  // so the gap between them spreads by the root of 2 / days. 2.58 makes it 99%.
  return 2.58 * spread * Math.sqrt(2 / days);
}

// Network numbers have no daily history yet, so a change under 10% is treated as noise.
export const RELATIVE_NOISE = 0.1;
