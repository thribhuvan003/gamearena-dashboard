import React, { useEffect, useRef, useState } from "react";
import { useReport } from "./api";
import { Notice, Pages, number, utcTime } from "./format";

// Units are not documented by the client; these match the value ranges in the data.
const MEASURES = [
  ["fps", "FPS", ""],
  ["latency", "Latency", " ms"],
  ["jitter", "Jitter", " ms"],
  ["bitrate", "Bitrate", " Mbps"],
];

// Access modes from client_connected, in plain words.
const WHO = {
  external: "External user",
  external_session: "External user",
  owner: "Owner",
  share: "Share link",
};

// Plain names for the events a founder is most likely to see. The raw name stays underneath.
const EVENTS = {
  "pipeline.connect.attempt": "Tried to connect",
  "pipeline.connect.success": "Connected, video started",
  "pipeline.connect.failure": "Connection error",
  "pipeline.connection.dropped": "Connection dropped",
  "media.decode.error": "Video could not be decoded",
  "ice.connection.state": "Network route changed",
  "media.first_decode": "First video frame",
  "webrtc.connection.state": "Video connection changed",
  "ice.candidate.error": "Network route error (usually harmless)",
  "ice.gathering.complete": "Network routes found",
  "ice.restart": "Network route restarted",
  "ws.connect": "Connection channel opened",
  "ws.disconnect": "Connection channel lost",
  "ws.reconnect.attempt": "Connection channel retry",
  "ws.reconnect.success": "Connection channel restored",
  "ws.reconnect.exhausted": "Connection channel gave up retrying",
  ws_error: "Connection channel error",
  session_started: "Session started",
  session_ended: "Session ended",
  client_connected: "Player joined",
  client_disconnected: "Player left",
  client_reconnected: "Player rejoined",
  host_connected: "Host joined",
  host_disconnected: "Host left",
};

const WHO_SENT = { client: "player app", host: "host", system: "server" };
const ROLES = { client: "player", host: "host" };

function plain(names, words) {
  return names
    ? names
        .split(", ")
        .map((name) => words[name] || name)
        .join(", ")
    : "—";
}

function DataTable({ columns, rows, label, empty }) {
  return (
    <div className="table-scroll">
      <table aria-label={label}>
        <thead>
          <tr>
            {columns.map((column) => (
              <th scope="col" key={column}>
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index}>
              {row.map((cell, i) => (
                <td key={columns[i]} data-label={columns[i]}>
                  {cell ?? "—"}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {!rows.length && <p>{empty || "Nothing recorded in these dates."}</p>}
    </div>
  );
}

// A summary tile. Tiles with an action open the matching events below.
function Tile({ label, value, onOpen }) {
  return (
    <div className="panel">
      <h4>{label}</h4>
      {onOpen ? (
        <button className="metric-number tile-link" onClick={onOpen}>
          {value}
        </button>
      ) : (
        <strong>{value}</strong>
      )}
    </div>
  );
}

function duration(row) {
  if (row.duration_seconds == null) return "—";
  const minutes = number(row.duration_seconds / 60, 1) + " min";
  return row.duration_is_minimum
    ? `At least ${minutes} (no end recorded)`
    : minutes;
}

// One session from our own telemetry: summary, then events, performance and connections.
export function SessionDetail({ id, period, onClose }) {
  const [whole, setWhole] = useState(false);
  const [tab, setTab] = useState("events");
  const [filters, setFilters] = useState({});
  const [page, setPage] = useState(1);
  const tabs = useRef(null);

  const scope = { ...period, whole: whole ? "1" : "0" };
  const result = useReport("sessions/" + id, scope);
  const detail = result.data;
  const row = detail?.session;
  // Connections come with the summary, and a session without stats has no batches to page.
  const pagedName = {
    events: "sessions/" + id + "/events",
    performance: row?.batches ? "sessions/" + id + "/buckets" : null,
  }[tab];
  const list = useReport(pagedName, { ...scope, ...filters, page });
  const metric = (name) => detail.metrics.find((m) => m.metric === name);

  useEffect(() => {
    document
      .getElementById("session-detail")
      ?.scrollIntoView({ behavior: "smooth" });
  }, []);

  function showEvents(level) {
    setTab("events");
    setFilters(level ? { level } : {});
    setPage(1);
    tabs.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function filterEvents(event) {
    event.preventDefault();
    setFilters(Object.fromEntries(new FormData(event.currentTarget)));
    setPage(1);
  }

  return (
    <article id="session-detail" className="panel session-detail">
      <button onClick={onClose}>Close</button>
      <h3>Session</h3>
      <p className="session-id">{id}</p>
      <button
        aria-pressed={whole}
        onClick={() => {
          setWhole(!whole);
          setPage(1);
        }}
      >
        {whole ? "Selected dates only" : "Whole session"}
      </button>
      <p>Times in UTC.</p>
      <Notice {...result} />

      {detail && (
        <>
          {row.why && (
            <p>
              <strong>{row.why}</strong>
            </p>
          )}
          <p>Whole session: {row.tags.join(" · ") || "not tagged yet"}</p>
          <div className="metric-grid">
            <Tile label="Started" value={utcTime(row.started_at)} />
            <Tile
              label="Ended"
              value={row.ended_at ? utcTime(row.ended_at) : "No end recorded"}
            />
            <Tile label="Duration" value={duration(row)} />
            <Tile label="Ended because" value={row.end_reason || "—"} />
            <Tile
              label="Wait until video"
              value={
                row.first_ready_ms == null
                  ? "Never got video"
                  : number(row.first_ready_ms / 1000, 1) + " s"
              }
            />
            <Tile label="Connect attempts" value={number(row.attempts)} />
            <Tile
              label="Host connections"
              value={number(row.host_connections)}
            />
            <Tile
              label="Player connections"
              value={number(row.client_connections)}
            />
            <Tile
              label="Who joined"
              value={
                row.access_modes
                  ? [
                      ...new Set(
                        row.access_modes.split(", ").map((m) => WHO[m] || m),
                      ),
                    ].join(", ")
                  : "—"
              }
            />
            <Tile label="Stream drops" value={number(row.stream_drops)} />
            <Tile label="Disconnects" value={number(row.disconnects)} />
            <Tile label="Reconnects" value={number(row.reconnects)} />
            <Tile
              label="Errors"
              value={number(row.errors)}
              onOpen={row.errors ? () => showEvents("error") : null}
            />
            <Tile
              label="Warnings"
              value={number(row.warnings)}
              onOpen={row.warnings ? () => showEvents("warn") : null}
            />
            {row.batches ? (
              MEASURES.map(([name, label, unit]) => (
                <Tile
                  key={name}
                  label={"Avg " + label}
                  value={number(metric(name)?.mean, 1) + unit}
                />
              ))
            ) : (
              <Tile label="Stream stats" value="None sent" />
            )}
          </div>

          <div
            className="tabs"
            role="tablist"
            aria-label="Session sections"
            ref={tabs}
          >
            {["events", "performance", "connections"].map((name) => (
              <button
                key={name}
                role="tab"
                aria-selected={tab === name}
                onClick={() => {
                  setTab(name);
                  setPage(1);
                }}
              >
                {name[0].toUpperCase() + name.slice(1)}
              </button>
            ))}
          </div>

          {tab === "events" && (
            <>
              {/* The key resets the form when a tile sets a filter. */}
              <form
                className="session-filters"
                key={JSON.stringify(filters)}
                onSubmit={filterEvents}
              >
                <label>
                  Level
                  <select name="level" defaultValue={filters.level || ""}>
                    <option value="">All</option>
                    {["error", "warn", "info"].map((level) => (
                      <option key={level}>{level}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Sent by
                  <select name="source" defaultValue={filters.source || ""}>
                    <option value="">All</option>
                    {[
                      ...new Set(
                        detail.connections
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
                <label>
                  Connection
                  <select
                    name="connection"
                    defaultValue={filters.connection || ""}
                  >
                    <option value="">All</option>
                    <option value="missing">Not tied to a connection</option>
                    {detail.connections
                      .map((c) => c.connection_id)
                      .filter(Boolean)
                      .map((connection) => (
                        <option key={connection}>{connection}</option>
                      ))}
                  </select>
                </label>
                <button>Filter</button>
              </form>
              <Notice {...list} />
              {list.data && (
                <DataTable
                  label="Session events"
                  columns={[
                    "Time",
                    "Event",
                    "Level",
                    "Sent by",
                    "Connection",
                    "Error details",
                    "Video wait",
                  ]}
                  rows={list.data.items.map((e) => [
                    utcTime(e.recorded_at),
                    <>
                      {EVENTS[e.pipeline_event || e.event_type] ||
                        e.pipeline_event ||
                        e.event_type}
                      <small>{e.pipeline_event || e.event_type}</small>
                    </>,
                    e.level,
                    plain(e.source, WHO_SENT),
                    e.connection_id || "—",
                    [e.phase, e.stage, e.error_code]
                      .filter(Boolean)
                      .join(" · ") || "—",
                    e.ready_ms == null
                      ? "—"
                      : number(e.ready_ms / 1000, 1) + " s",
                  ])}
                />
              )}
            </>
          )}

          {tab === "connections" && (
            <DataTable
              label="Session connections"
              columns={[
                "Connection",
                "Role",
                "Sent by",
                "First event",
                "Last event",
                "Attempts",
                "Connected",
                "Failed",
                "Disconnects",
                "Reconnects",
              ]}
              rows={detail.connections.map((c) => [
                c.connection_id || "Not tied to a connection",
                plain(c.roles, ROLES),
                plain(c.sources, WHO_SENT),
                utcTime(c.first_seen),
                utcTime(c.last_seen),
                number(c.attempts),
                number(c.successes),
                number(c.failures),
                number(c.disconnects),
                number(c.reconnects),
              ])}
            />
          )}

          {tab === "performance" &&
            (row.batches ? (
              <>
                <DataTable
                  label="Session performance summary"
                  columns={[
                    "Measurement",
                    "Average",
                    "Lowest",
                    "Highest",
                    "Readings",
                    "Missing",
                  ]}
                  rows={detail.metrics.map((m) => [
                    m.metric,
                    number(m.mean, 1),
                    number(m.minimum, 1),
                    number(m.maximum, 1),
                    number(m.valid),
                    number(m.missing),
                  ])}
                />
                <h4>Every 10 seconds</h4>
                <Notice {...list} />
                {list.data && (
                  <DataTable
                    label="Session stats batches"
                    columns={["Start", "End", ...MEASURES.map((m) => m[1])]}
                    rows={list.data.items.map((b) => [
                      utcTime(b.bucket_start),
                      utcTime(b.bucket_end),
                      ...MEASURES.map(([name, , unit]) =>
                        b.metrics?.[name]
                          ? number(b.metrics[name].mean, 1) + unit
                          : "—",
                      ),
                    ])}
                  />
                )}
              </>
            ) : (
              <p>
                This session sent no performance stats, so there is no FPS,
                latency or bitrate to show. Its events and connections are still
                here.
              </p>
            ))}

          {tab !== "connections" && (tab === "events" || row.batches > 0) && (
            <Pages
              data={list.data}
              page={page}
              onChange={setPage}
              busy={list.loading}
            />
          )}
        </>
      )}
    </article>
  );
}
