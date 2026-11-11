// The table and the summary tile used all through the session pop-up, so every list and
// number in it looks and reads the same.
import React from "react";
import { Info } from "./format";

// Columns holding numbers line up on the right, so they compare at a glance.
const NUMERIC = new Set([
  "Attempts",
  "Connected",
  "Connection errors",
  "Disconnects",
  "Reconnects",
  "Average",
  "Lowest",
  "Highest",
  "Seconds measured",
  "Seconds with no value",
]);

// The one table used throughout the pop-up. Each cell carries its column name (data-label) so
// that on a phone, where rows stack as cards, every value keeps its label. `tall` gives the
// event list its own scroll box, with headings that stay in view.
export function DataTable({
  columns: allColumns,
  rows: allRows,
  label,
  notes = {},
  tall = false,
}) {
  // A column that is empty on every row is left out; it would only show dashes.
  const keep = allColumns.map(
    (_, i) =>
      !allRows.length ||
      allRows.some((row) => row[i] != null && row[i] !== "—"),
  );
  const columns = allColumns.filter((_, i) => keep[i]);
  const rows = allRows.map((row) => row.filter((_, i) => keep[i]));
  return (
    <div className={"table-scroll" + (tall ? " tall" : "")}>
      <table aria-label={label}>
        <thead>
          <tr>
            {columns.map((column) => (
              <th
                scope="col"
                key={column}
                className={NUMERIC.has(column) ? "num" : undefined}
              >
                {column}
                {notes[column] && <Info topic={column}>{notes[column]}</Info>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index}>
              {row.map((cell, i) => (
                <td
                  key={columns[i]}
                  data-label={columns[i]}
                  className={NUMERIC.has(columns[i]) ? "num" : undefined}
                >
                  {cell ?? "—"}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {/* An empty table says so, rather than showing headings over nothing. */}
      {!rows.length && <p>Nothing recorded for this session.</p>}
    </div>
  );
}

// A summary tile: label, number and an optional line under it. When a tile has an action, its
// number becomes a button that opens the matching events below.
export function Tile({ label, value, onOpen, info, sub }) {
  return (
    <div className="panel">
      <h3>
        {label}
        {info && <Info topic={label}>{info}</Info>}
      </h3>
      {onOpen ? (
        <button className="metric-number tile-link" onClick={onOpen}>
          {value}
        </button>
      ) : (
        <strong>{value}</strong>
      )}
      {sub && <small>{sub}</small>}
    </div>
  );
}
