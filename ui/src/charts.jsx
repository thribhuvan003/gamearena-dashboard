import React from "react";
import { dateLabel, number } from "./format";
import "./charts.css";

// Every chart on the dashboard: the stacked outcome bar, ranked bars and the small trend lines.

// How sessions ended up, one colour per outcome, used by every chart and list.
// Greens got video, amber got video but a later try failed, red and orange never did
// (red sent an error, orange didn't), grey never tried.
export const OUTCOME_COLOURS = {
  outcome_connected: "#2f6b3a",
  outcome_recovered: "#86b07a",
  outcome_later_failed: "#d97706",
  outcome_failed: "#b91c1c",
  outcome_silent: "#ea580c",
  outcome_not_tried: "#a3a3a3",
};

// A "how far it got" reason takes the colour of the outcome it belongs to.
export function reasonColour(text) {
  if (text === "Connected") return OUTCOME_COLOURS.outcome_connected;
  if (text === "Connected after an error")
    return OUTCOME_COLOURS.outcome_recovered;
  if (text.startsWith("Connected, but"))
    return OUTCOME_COLOURS.outcome_later_failed;
  if (text.startsWith("Failed")) return OUTCOME_COLOURS.outcome_failed;
  if (text.startsWith("No error")) return OUTCOME_COLOURS.outcome_silent;
  return OUTCOME_COLOURS.outcome_not_tried;
}

const share = (count, total) => (total ? (count / total) * 100 : 0);
const percent = (value) => number(value, 1) + "%";

// One row per item, longest first, each a button that opens the sessions behind it.
// rows: [{ key, label, detail?, tag?, count, colour?, onClick, active? }]
export function RankedBars({ rows, total, unit = "sessions", label }) {
  const most = Math.max(1, ...rows.map((row) => row.count));
  return (
    <ul className="ranked-bars" aria-label={label}>
      {rows.map((row) => (
        <li key={row.key}>
          <button
            type="button"
            className="bar-row"
            aria-pressed={Boolean(row.active)}
            onClick={row.onClick}
            title={`View these ${number(row.count)} ${unit}`}
          >
            <span className="bar-label">
              {row.label}
              {row.tag && <span className="bar-tag">{row.tag}</span>}
              {row.detail && <code className="bar-detail">{row.detail}</code>}
            </span>
            <span className="bar-track" aria-hidden="true">
              <span
                className="bar-fill"
                style={{
                  width: `${(row.count / most) * 100}%`,
                  background: row.colour,
                }}
              />
            </span>
            <span className="bar-count">
              {number(row.count)}
              {total ? (
                <small> · {percent(share(row.count, total))}</small>
              ) : null}
            </span>
            <span className="bar-go" aria-hidden="true">
              ›
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

// One bar split into parts of a whole, with a clickable key under it.
// The bar is a mouse shortcut; the key below says the same in words, so screen readers
// and keyboards use the key and skip the bar.
// parts: [{ key, label, count, colour, onClick, active? }]
export function StackedBar({ parts, total, label }) {
  const shown = parts.filter((part) => part.count > 0);
  return (
    <div className="stacked">
      <div className="stacked-bar" aria-hidden="true">
        {shown.map((part) => (
          <button
            type="button"
            key={part.key}
            className="stacked-part"
            style={{
              width: `${share(part.count, total)}%`,
              background: part.colour,
            }}
            onClick={part.onClick}
            title={`${part.label}: ${number(part.count)} (${percent(share(part.count, total))})`}
            tabIndex={-1}
          />
        ))}
      </div>
      <ul className="stacked-key" aria-label={label}>
        {shown.map((part) => (
          <li key={part.key}>
            <button
              type="button"
              className="key-row"
              aria-pressed={Boolean(part.active)}
              onClick={part.onClick}
            >
              <span
                className="swatch"
                style={{ background: part.colour }}
                aria-hidden="true"
              />
              <span>{part.label}</span>
              <strong>{number(part.count)}</strong>
              <small>{percent(share(part.count, total))}</small>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

// Under this many sessions, one unusual session can move a day's number a lot.
const FEW = 30;

const dayCount = (n) => `${n} ${n === 1 ? "day" : "days"}`;

// A small line of one number per day, ending on the last selected day.
// It is drawn so it never overstates a change: small changes stay small, a day with no
// value leaves a gap, and days with few sessions are drawn faint.
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
