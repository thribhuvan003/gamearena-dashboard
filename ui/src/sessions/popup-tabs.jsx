// The event list in the session pop-up: each event's plain name with what the app sent, the
// filters above the list and the table itself. Raw names and messages need technical details.
import React from "react";
import { Info, Notice, number, utcTime } from "../lib/format";
import {
  EVENT_NOTES,
  LEVELS,
  MEASUREMENTS,
  PERFORMANCE_NOTES,
  WHO_SENT,
  clock,
  eventName,
  heading,
  plain,
} from "./words";

// What the telemetry says about an event, as sent: the app's own text (reason) in quotes, then its
// code, stage, phase and any state change or retry. Server addresses stay in technical details.
export function Told({ fact }) {
  const parts = [
    fact.error_code != null && "code " + fact.error_code,
    // The plain stage name goes in brackets only when it says more than the stage itself.
    fact.stage &&
      "stage " +
        fact.stage +
        (fact.stage_name && fact.stage_name !== fact.stage.toLowerCase()
          ? ` (${fact.stage_name})`
          : ""),
    fact.phase && "phase " + fact.phase,
    (fact.prev || fact.state) && `${fact.prev || "?"} → ${fact.state || "?"}`,
    fact.attempt != null && "attempt " + fact.attempt,
    fact.delay_ms != null && `delay ${number(fact.delay_ms / 1000, 1)}\u00a0s`,
    fact.ready_ms != null &&
      `time to video ${number(fact.ready_ms / 1000, 1)}\u00a0s`,
  ].filter(Boolean);
  // Nothing was sent beyond the event name, so there is no line to add under it.
  if (!fact.reason && !parts.length) return null;
  return (
    <small className="told">
      {fact.reason && <q>{fact.reason}</q>}
      {parts.length > 0 && <span>{parts.join(" · ")}</span>}
    </small>
  );
}

// The same facts for one timeline row. Normal events only show their time to video.
function eventFact(e) {
  if (e.level === "info") return { ready_ms: e.ready_ms };
  const sent = e.payload || {};
  const name = e.pipeline_event || e.event_type;
  return {
    ...e,
    // The message only repeats the event name on connection errors, so the reason comes first.
    reason:
      sent.reason ?? sent.errorText ?? (e.message !== name ? e.message : null),
    prev: sent.prev,
    state: sent.state,
    attempt: sent.attempt,
    delay_ms: sent.delayMs,
  };
}

// Events: plain columns for everyone; the app's own names and raw messages only with technical details.
export function EventTable({ items, technical }) {
  const { day, time } = clock(items.map((e) => e.recorded_at));
  return (
    <>
      {/* When every event falls on one day, the date is said once here and rows show only the time. */}
      {day && <p className="table-note">All on {day} (UTC).</p>}
      <DataTable
        label="Session events"
        notes={EVENT_NOTES}
        tall
        columns={[
          "Time",
          "What happened",
          "Level",
          "Sent by",
          ...(technical
            ? ["App's event name", "Connection", "Message from the app"]
            : []),
        ]}
        rows={items.map((e) => [
          time(e.recorded_at),
          <div>
            {eventName(e)}
            <Told fact={eventFact(e)} />
          </div>,
          <span className={"chip level-" + e.level}>
            {LEVELS[e.level] || e.level}
          </span>,
          plain(e.source, WHO_SENT),
          ...(technical
            ? [
                <code>{e.pipeline_event || e.event_type}</code>,
                e.connection_id || "—",
                // The raw message folds away on every row; it can run to many lines.
                <details>
                  <summary>Show</summary>
                  <pre className="raw-event">
                    {[e.message, JSON.stringify(e.payload, null, 2)]
                      .filter(Boolean)
                      .join("\n\n")}
                  </pre>
                </details>,
              ]
            : []),
        ])}
      />
    </>
  );
}

// The filters above the event list: level, who sent it and, with technical details, the
// connection. The pop-up holds the chosen filters, so a tile that sets one updates these too.
export function EventFilters({
  filters,
  filterEvents,
  connections,
  technical,
}) {
  return (
    <div className="session-filters" role="group" aria-label="Filter events">
      <label>
        Level
        <select
          name="level"
          value={filters.level || ""}
          onChange={filterEvents}
        >
          <option value="">All</option>
          {Object.entries(LEVELS).map(([level, label]) => (
            <option key={level} value={level}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Sent by
        <select
          name="source"
          value={filters.source || ""}
          onChange={filterEvents}
        >
          <option value="">All</option>
          {/* Only the senders that appear in this session, so no choice leads to an empty list. */}
          {[
            ...new Set(
              connections
                .flatMap((c) => (c.sources || "").split(", "))
                .filter(Boolean),
            ),
          ].map((source) => (
            <option key={source} value={source}>
              {WHO_SENT[source] || source}
            </option>
          ))}
        </select>
      </label>
      {/* Connection IDs mean nothing outside engineering, so this filter is technical only.
          "missing" asks for the events sent before any connection existed. */}
      {technical && (
        <label>
          Connection
          <select
            name="connection"
            value={filters.connection || ""}
            onChange={filterEvents}
          >
            <option value="">All</option>
            <option value="missing">Not tied to a connection</option>
            {connections
              .map((c) => c.connection_id)
              .filter(Boolean)
              .map((connection) => (
                <option key={connection}>{connection}</option>
              ))}
          </select>
        </label>
      )}
    </div>
  );
}

// Stream quality in the session pop-up: the one-line verdict under the summary and the Stream
// quality tab. Only facts measured in this session; the full tables need technical details.
// Stream quality in one sentence: only facts measured in this session.
export function verdict(metrics, batches) {
  if (!batches)
    return "The player app sent no stream readings for this session.";
  const fps = metrics.find((m) => m.metric === "fps");
  const delay = metrics.find((m) => m.metric === "latency");
  const parts = [];
  if (fps?.valid) {
    const under = fps.under_30 / fps.valid;
    parts.push(
      under === 0
        ? "never under 30 FPS"
        : `under 30 FPS for ${number(under * 100, 1)}% of the time`,
    );
  }
  if (delay?.valid)
    parts.push(
      `typical delay ${number(delay.mean, 0)}\u00a0ms (worst second ${number(delay.maximum, 0)}\u00a0ms)`,
    );
  return parts.length ? "Stream quality: " + parts.join(" · ") + "." : "";
}

// The few stream numbers a founder can act on, each with its average and one telling extreme.
// Each entry: measurement, tile label, unit after the average, and the line under it.
const QUALITY_TILES = [
  [
    "fps",
    "Frames per second",
    "",
    // No valid readings means no share to give, rather than "NaN%".
    (m) =>
      m.valid
        ? `${number((m.under_30 / m.valid) * 100, 1)}% of the time under 30`
        : null,
  ],
  [
    "latency",
    "Latency (latency)",
    "\u00a0ms",
    (m) => `Worst second: ${number(m.maximum, 0)}\u00a0ms`,
  ],
  [
    "downloadSpeed",
    "Download speed (downloadSpeed)",
    "\u00a0Mbps",
    (m) => `Lowest: ${number(m.minimum, 1)}\u00a0Mbps`,
  ],
  [
    "bitrate",
    "Bitrate (bitrate)",
    "\u00a0Mbps",
    (m) => `Lowest: ${number(m.minimum, 1)}\u00a0Mbps`,
  ],
  [
    "skippedFrames",
    "Skipped frames each second",
    "",
    (m) => `Worst second: ${number(m.maximum, 0)}`,
  ],
];

// Stream quality: tiles for everyone, the full tables with technical details, and a
// plain sentence when the app sent no readings at all. `list` is the loaded page of
// 10-second groups.
export function StreamQuality({ batches, metrics, technical, list }) {
  return batches ? (
    <>
      <div className="metric-grid">
        {QUALITY_TILES.map(([name, label, unit, describe]) => {
          const m = metrics.find((m) => m.metric === name);
          // A measurement the app never sent gets no tile, rather than one full of dashes.
          if (!m) return null;
          return (
            <Tile
              key={name}
              label={label}
              value={number(m.mean, 1) + unit}
              sub={describe(m)}
              info={MEASUREMENTS[name][2]}
            />
          );
        })}
      </div>
      {technical && (
        <>
          <p>
            The player app records one reading per second for each measurement
            and sends them in groups of 10. Each reading is that second&apos;s
            own value, not a running total.
          </p>
          <DataTable
            label="Session performance summary"
            notes={PERFORMANCE_NOTES}
            columns={[
              "Measurement",
              "Average",
              "Lowest",
              "Highest",
              "Seconds measured",
              "Seconds with no value",
            ]}
            rows={metrics.map((m) => [
              heading(m.metric),
              number(m.mean, 1),
              number(m.minimum, 1),
              number(m.maximum, 1),
              number(m.valid),
              number(m.missing),
            ])}
          />
          <h3>
            Every 10 seconds
            <Info topic="Every 10 seconds">
              Each row is one group of 10 readings; each number is the average
              of that group.
            </Info>
          </h3>
          <Notice {...list} />
          {list.data && (
            <DataTable
              label="Session stats batches"
              columns={[
                "Start",
                "End",
                ...Object.keys(MEASUREMENTS).map(heading),
              ]}
              rows={list.data.items.map((b) => [
                utcTime(b.bucket_start, true),
                utcTime(b.bucket_end, true),
                // Every measurement gets a column in the same order; one missing from a group shows a dash.
                ...Object.keys(MEASUREMENTS).map((name) =>
                  b.metrics?.[name] ? number(b.metrics[name].mean, 1) : "—",
                ),
              ])}
            />
          )}
        </>
      )}
    </>
  ) : (
    <p>
      The player app sent no stream readings for this session, so there is
      nothing to show here.
    </p>
  );
}

// The table and the summary tile used all through the session pop-up, so every list and
// number in it looks and reads the same.
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
