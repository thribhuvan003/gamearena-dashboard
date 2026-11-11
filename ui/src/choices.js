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
