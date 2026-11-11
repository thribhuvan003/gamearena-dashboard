// The error table: every error event exactly as sent, with how many sessions had it.
// Clicking a row's event or count picks that error and lists its sessions.
import React from "react";
import { Info, number, plural } from "../lib/format";

// The error table's columns: [heading, what it means, class].
const ERROR_COLUMNS = [
  [
    "Event",
    "The app's own event name. Click it or its session count to see those sessions.",
  ],
  ["Code"],
  ["Stage", "The part of the app the error came from, as sent."],
  ["Phase", "How far the connection was when it failed, as sent."],
  [
    "When",
    "Before it ended: a real error. After it ended: the app retried a session that had already closed, so it is not counted as a failure anywhere else on this page.",
  ],
  [
    "What the app said",
    "The error's own text, unchanged: its reason or error text, or for a connection state change, the state before and after.",
  ],
  ["Sessions", "How many sessions had this exact error.", "num"],
  ["Times", "How many times it happened in those sessions.", "num"],
];

// Every error event with its code, stage, phase and text, exactly as sent, and how many
// sessions had it.
export function ErrorReasons({ rows, error, onPick }) {
  // How many different event names there are, for the line on the folded heading.
  const events = new Set(rows.map((row) => row.event));
  // Whether a row is the error picked now, so that row is highlighted.
  const same = (row) =>
    ["code", "event", "stage", "phase", "reason"].every(
      (key) => error?.[key] === row[key],
    ) && error?.afterEnd === row.after_end;
  return (
    <details className="section">
      <summary>
        Every error, as sent
        <span className="summary-hint">
          {rows.length
            ? `${plural(events.size, "error event")} · ${plural(rows.length, "different combination")} of event, code, stage, phase and text`
            : "No errors on these dates"}
        </span>
      </summary>
      {rows.length > 0 && (
        <div className="table-scroll tall">
          <table aria-label="Every error, as sent">
            <thead>
              <tr>
                {ERROR_COLUMNS.map(([heading, info, className]) => (
                  <th key={heading} scope="col" className={className}>
                    {heading}
                    {info && <Info topic={heading}>{info}</Info>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={[
                    row.event,
                    row.code,
                    row.stage,
                    row.phase,
                    row.reason,
                    row.after_end,
                  ].join("|")}
                  className={same(row) ? "open-row" : undefined}
                >
                  <td data-label="Event">
                    <button
                      type="button"
                      className="link-button"
                      onClick={() => onPick(row)}
                      aria-label={`Show the ${plural(row.sessions, "session")} with this error`}
                    >
                      <code>{row.event}</code>
                    </button>
                  </td>
                  <td data-label="Code">
                    <strong>{row.code || "—"}</strong>
                  </td>
                  <td data-label="Stage">{row.stage || "—"}</td>
                  <td data-label="Phase">{row.phase || "—"}</td>
                  <td data-label="When">
                    {row.after_end
                      ? "After it ended (retry)"
                      : "Before it ended"}
                  </td>
                  <td data-label="What the app said">
                    <code>{row.reason || "—"}</code>
                  </td>
                  <td data-label="Sessions" className="num">
                    <button
                      type="button"
                      className="link-button"
                      onClick={() => onPick(row)}
                    >
                      {number(row.sessions)}
                    </button>
                  </td>
                  <td data-label="Times" className="num">
                    {number(row.events)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </details>
  );
}
