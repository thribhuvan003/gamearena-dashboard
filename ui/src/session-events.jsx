// The event list in the session pop-up: each event's plain name with what the app sent, the
// filters above the list and the table itself. Raw names and messages need technical details.
import React from "react";
import { number } from "./format";
import { DataTable } from "./session-table";
import {
  EVENT_NOTES,
  LEVELS,
  WHO_SENT,
  clock,
  eventName,
  plain,
} from "./session-words";

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
