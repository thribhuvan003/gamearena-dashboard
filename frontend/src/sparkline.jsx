import React from "react";
import { dateLabel } from "./format";

// Under this many sessions, one unusual session can move a day's number a lot.
const FEW = 30;

const dayCount = (n) => `${n} ${n === 1 ? "day" : "days"}`;

// A small line of one number per day, ending on the last selected day (marked with a dot).
// It is drawn so it never overstates a change: small changes stay small, a day with no
// value leaves a gap, and days with few sessions are drawn faint with a hollow point.
// `counts` is optional: sessions per day, in the same order as `trend`.
export function Sparkline({ trend, field, format, counts }) {
  const values = trend.map((day) => day[field]);
  const known = values.filter((value) => value != null);
  if (known.length < 2) return null;
  const low = Math.min(...known);
  const high = Math.max(...known);
  const few = (i) => counts?.[i] != null && counts[i] < FEW;

  // The range of values the box's height stands for. Stretching every line to its own
  // lowest and highest day would make 9.4 s to 9.6 s look as big a swing as a doubling.
  let bottom;
  let top;
  if (String(format(high)).endsWith("%")) {
    // A percentage starts at 0%, so how high the line sits is the share itself.
    bottom = 0;
    top = high || 1;
  } else {
    // Anything else gets a range at least 20% of its typical value: a change smaller
    // than that is drawn to scale, so a steady number looks steady.
    const middle = (low + high) / 2;
    const span = Math.max(high - low, Math.abs(middle) * 0.2) || 1;
    // Counts and times can't go below zero, so neither does the range.
    bottom = low >= 0 ? Math.max(0, middle - span / 2) : middle - span / 2;
    top = bottom + span;
  }
  const x = (i) => 2 + (i / (values.length - 1)) * 156;
  const y = (value) => 26 - ((value - bottom) / (top - bottom)) * 22;

  // Pieces of line between neighbouring days that both have a value. A day with no value
  // leaves a gap instead of a straight line that invents the days in between.
  // Pieces touching a day with few sessions are drawn faint.
  const pieces = [];
  for (let i = 1; i < values.length; i++) {
    if (values[i - 1] == null || values[i] == null) continue;
    const faint = few(i - 1) || few(i);
    const piece = pieces[pieces.length - 1];
    if (piece && piece.faint === faint && piece.days.at(-1) === i - 1)
      piece.days.push(i);
    else pieces.push({ faint, days: [i - 1, i] });
  }

  const last = values.length - 1;
  const missing = values.length - known.length;
  const thin = values.filter((value, i) => value != null && few(i)).length;
  const summary = [
    `From ${dateLabel(trend[0].day)} to ${dateLabel(trend[last].day)}: lowest ${format(low)}, highest ${format(high)}`,
    missing > 0 && `${dayCount(missing)} with no value`,
    thin > 0 && `${dayCount(thin)} with under ${FEW} sessions`,
  ]
    .filter(Boolean)
    .join(". ");

  // Hovering a day shows its value, and says so when it rests on only a few sessions.
  const label = (i) =>
    `${dateLabel(trend[i].day)}: ${format(values[i])}` +
    (few(i)
      ? ` (only ${counts[i]} ${counts[i] === 1 ? "session" : "sessions"})`
      : "");

  // Points are zero-length lines with round ends, so they stay round although the
  // box stretches sideways to fit the card.
  const dot = (i, className) => (
    <line
      key={className + i}
      className={className}
      x1={x(i)}
      y1={y(values[i])}
      x2={x(i)}
      y2={y(values[i])}
    />
  );

  return (
    <svg
      className="sparkline"
      viewBox="0 0 160 30"
      preserveAspectRatio="none"
      role="img"
      aria-label={summary}
    >
      <title>{summary}</title>
      {pieces.map((piece) => (
        <polyline
          key={piece.days[0]}
          className={piece.faint ? "faint" : undefined}
          points={piece.days
            .map((i) => `${x(i).toFixed(1)},${y(values[i]).toFixed(1)}`)
            .join(" ")}
        />
      ))}
      {values.flatMap((value, i) => {
        if (value == null || i === last) return [];
        // A hollow ring: a dot with a smaller dot in the card's colour on top.
        if (few(i)) return [dot(i, "few-point"), dot(i, "few-point-hole")];
        // A day with no value on either side has no line, so it needs a dot to be seen.
        if (values[i - 1] == null && values[i + 1] == null)
          return [dot(i, "lone-point")];
        return [];
      })}
      {values[last] != null && dot(last, "last-point")}
      {/* The last day keeps its dark dot; few sessions there make it a dark ring. */}
      {values[last] != null && few(last) && dot(last, "few-point-hole")}
      {values.map(
        (value, i) =>
          value != null && (
            <circle
              key={trend[i].day}
              className="hover-point"
              cx={x(i)}
              cy={y(value)}
              r="6"
            >
              <title>{label(i)}</title>
            </circle>
          ),
      )}
    </svg>
  );
}
