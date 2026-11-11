// Plain helpers the main page shares: how numbers and dates are written, how a change is put
// in words, and how the error picked in the error table is kept and shown.
import { dateLabel, number } from "../lib/format";

// How each kind of number is written, one decimal each.
export const percent = (value) => number(value, 1) + "%";
export const seconds = (value) => number(value, 1) + " s";
export const hours = (value) => number(value, 1) + " h";
export const plain = (value) => number(value, 1);

// The dates in words: one day, or the first and last.
export const datesText = (period) =>
  period.start === period.end
    ? dateLabel(period.end)
    : `${dateLabel(period.start)} – ${dateLabel(period.end)}`;

// What the selected dates are compared with, in words.
export function versusWords(days) {
  if (days === 1) return "the same day last week";
  if (days < 7) return "the same days a week earlier";
  if (days === 7) return "the week before";
  return `the ${days} days before`;
}

// Plain words with the old value and whether that is good news,
// e.g. "▲ Worse · was 9.6 s the same day last week". Session counts have no good direction,
// so they read "▲ Up" or "▼ Down" instead.
export function difference(
  now,
  before,
  format,
  versus,
  higherIsBetter,
  noise = 0,
  tooFew = false,
) {
  // Nothing to compare with: no line at all.
  if (now == null || before == null) return null;
  if (tooFew)
    return { text: `Too few sessions to compare with ${versus}`, tone: "" };
  // Inside the normal day-to-day range, a change is not a change. Nor is one too small
  // to show once rounded. Either way the line just gives the old value, e.g.
  // "Same day last week: 9.6 s".
  if (format(now) === format(before) || Math.abs(now - before) <= noise)
    return {
      text: `${versus.replace(/^the (.)/, (_, first) => first.toUpperCase())}: ${format(before)}`,
      tone: "",
    };
  // Better or worse depends on which way is good for this number; with no good way
  // (higherIsBetter is null) it is only up or down.
  const up = now > before;
  const tone =
    higherIsBetter == null ? "" : up === higherIsBetter ? "better" : "worse";
  const word = tone
    ? tone[0].toUpperCase() + tone.slice(1)
    : up
      ? "Up"
      : "Down";
  return {
    text: `${up ? "▲" : "▼"} ${word} · was ${format(before)} ${versus}`,
    tone,
  };
}

// What each share is out of, in words. Any group not listed is out of those who tried
// to connect.
export const BASE_WORDS = {
  stream_drops: "connected sessions",
  connected_no_stats: "connected sessions",
  low_fps: "sessions with readings",
  any_low_fps: "sessions with readings",
  high_skip: "sessions with readings",
};

// The error picked in the error table, as kept in the address bar. An error is picked by its
// event; the code can be empty, because some error events carry none.
export function errorFrom(url) {
  return url.error_event
    ? {
        code: url.error_code || "",
        event: url.error_event,
        stage: url.error_stage || "",
        phase: url.error_phase || "",
        reason: url.error_reason || "",
        afterEnd: url.error_after_end === "1",
      }
    : null;
}
// The picked error as address-bar and request parameters. With no error every value is
// undefined, which clears it from the address bar and leaves it out of the request.
export const errorParams = (error) => ({
  error_code: error?.code,
  error_event: error?.event,
  error_stage: error?.stage,
  error_phase: error?.phase,
  error_reason: error?.reason,
  error_after_end: error ? (error.afterEnd ? "1" : "0") : undefined,
});
// How the picked error reads in a chip or a title: what the telemetry says, as sent.
export const errorText = (error) =>
  [
    error.event,
    error.code && "code " + error.code,
    error.stage,
    error.phase,
    error.reason ? `"${error.reason}"` : "",
    error.afterEnd && "after it ended",
  ]
    .filter(Boolean)
    .join(" · ");
