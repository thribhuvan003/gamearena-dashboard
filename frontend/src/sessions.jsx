import React, { useEffect, useRef, useState } from "react";
import { useReport } from "./api";
import { Info, Notice, Pages, number, utcTime } from "./format";

// Units are not documented by the client; these match the value ranges in the data.
const MEASURES = [
  ["fps", "FPS", ""],
  ["latency", "Latency", " ms"],
  ["jitter", "Jitter", " ms"],
  ["bitrate", "Bitrate", " Mbps"],
];

// Every measurement the player app sends, in plain words. Units are not documented by the
// client; these match the value ranges in the data and should be confirmed by the team.
const MEASUREMENTS = {
  fps: ["Frames per second", "How smooth the video was. 30 is the idle rate."],
  latency: ["Delay (ms)", "Time for a signal to go to the host and back."],
  jitter: ["Delay variation (ms)", "How much the delay jumped around."],
  bitrate: [
    "Video data rate (Mbps)",
    "How much video data arrived each second.",
  ],
  downloadSpeed: ["Download speed (Mbps)", "The player's internet speed."],
  decodeDuration: [
    "Time to show a frame (ms)",
    "Player-side time to decode one frame.",
  ],
  encodeDuration: [
    "Time to prepare a frame (ms)",
    "Host-side time to encode one frame.",
  ],
  skippedFrames: [
    "Skipped frames per second",
    "Frames dropped instead of shown.",
  ],
  accumulatedFrames: [
    "Frames waiting",
    "Frames queued to be shown. Around 1 is normal.",
  ],
};

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

// What each column means, shown by its "i" button.
const CONNECTION_NOTES = {
  Connection:
    'The ID the app gives each connection. A player who leaves and rejoins gets a new one, so one person can have several rows. "Not tied to a connection" holds events sent before a connection existed, such as connect tries.',
  Role: "Whether this connection is the host (the gaming machine) or a player.",
  "Sent by":
    "Which side logged these events: the server, the player app or the host.",
  "First event": "Time of this connection's first event (UTC).",
  "Last event": "Time of this connection's last event (UTC).",
  Attempts: "How many times the app tried to connect.",
  Connected: "How many of those tries connected and started video.",
  "Connection errors":
    "Connection errors the app reported. This can be more than the attempts: one try can report more than one error, and the app sometimes keeps retrying after the session has already closed.",
  Disconnects: "How many times the player left.",
  Reconnects: "How many times the player came back.",
};
const PERFORMANCE_NOTES = {
  Measurement:
    "What the player app measured. Units are our reading of the values; the team should confirm them.",
  Average:
    "Add up every per-second reading and divide by how many there are. Covers every player in this session on the selected dates.",
  Lowest: "The smallest single-second reading.",
  Highest: "The biggest single-second reading.",
  "Seconds measured":
    "How many per-second readings the app sent. 60 is one minute.",
  "Seconds with no value":
    "Seconds where the value was empty or not a usable number. They are left out of the average.",
};
const EVENT_NOTES = {
  Event: "Plain name of what happened, with the app's own name underneath.",
  Level:
    "error: something failed. warn: something went wrong but may have recovered. info: normal activity.",
  "Sent by":
    "Which side logged the event: the server, the player app or the host.",
  Connection: "The connection the event belongs to, if any.",
  "Error details":
    "The code, the part of the app (stage) and the step, exactly as the app sent them.",
  "Message from the app":
    "The event exactly as the app sent it, unchanged: its message and every field.",
  "Video wait":
    "On a successful connect: time from connecting to the first video frame.",
};

function DataTable({ columns, rows, label, empty, notes = {} }) {
  return (
    <div className="table-scroll">
      <table aria-label={label}>
        <thead>
          <tr>
            {columns.map((column) => (
              <th scope="col" key={column}>
                {column}
                {notes[column] && <Info>{notes[column]}</Info>}
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
function Tile({ label, value, onOpen, info }) {
  return (
    <div className="panel">
      <h4>
        {label}
        {info && <Info>{info}</Info>}
      </h4>
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
  const dialog = useRef(null);

  // Opens as a pop-up over the list. Esc, the Close button or a click outside closes it.
  useEffect(() => {
    dialog.current?.showModal();
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
    <dialog
      ref={dialog}
      className="panel session-detail"
      aria-label="Session details"
      onClose={onClose}
      onClick={(event) => {
        if (event.target === dialog.current) dialog.current.close();
      }}
    >
      <button onClick={() => dialog.current.close()}>Close</button>
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
              <Info>
                Our plain-words summary of the furthest step this session
                reached. The app's own message is below and in the Events tab.
              </Info>
            </p>
          )}
          {row.last_error_message && (
            <p>
              Latest connection error, exactly as the app sent it:{" "}
              <code>{row.last_error_message}</code>
            </p>
          )}
          <p>Whole session: {row.tags.join(" · ") || "not tagged yet"}</p>
          <div className="metric-grid">
            <Tile
              label="Started"
              value={utcTime(row.started_at)}
              info="When the server logged the session start (UTC)."
            />
            <Tile
              label="Ended"
              value={row.ended_at ? utcTime(row.ended_at) : "No end recorded"}
              info="When the server logged the session end (UTC)."
            />
            <Tile
              label="Duration"
              value={duration(row)}
              info="End minus start. With no end recorded, it runs to the last event, so it is a minimum."
            />
            <Tile
              label="Ended because"
              value={row.end_reason || "—"}
              info="The reason the server gave for closing the session. Device deleted means the cloud gaming server was removed, by the provider or during a test, so it is not an error in the session."
            />
            <Tile
              label="Wait until video"
              info="Time from connecting to the first video frame, for the first successful connect."
              value={
                row.first_ready_ms == null
                  ? "Never got video"
                  : number(row.first_ready_ms / 1000, 1) + " s"
              }
            />
            <Tile
              label="Connect attempts"
              value={number(row.attempts)}
              info="How many times the app tried to connect."
            />
            <Tile
              label="Host connections"
              value={number(row.host_connections)}
              info="Different host connections in this session. Usually 1."
            />
            <Tile
              label="Player connections"
              value={number(row.client_connections)}
              info="Different player connections. A player who leaves and rejoins gets a new connection, so this counts joins, not people."
            />
            <Tile
              label="Who joined"
              info="How players joined: as the owner, through a share link, or as an external user."
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
            <Tile
              label="Stream drops"
              value={number(row.stream_drops)}
              info="Times the video connection went from connected to lost while playing."
            />
            <Tile
              label="Disconnects"
              value={number(row.disconnects)}
              info="Times a player left."
            />
            <Tile
              label="Reconnects"
              value={number(row.reconnects)}
              info="Times a player came back."
            />
            <Tile
              label="Errors"
              value={number(row.errors)}
              onOpen={row.errors ? () => showEvents("error") : null}
              info="Events the app marked as errors. Click the number to see them."
            />
            <Tile
              label="Warnings"
              value={number(row.warnings)}
              onOpen={row.warnings ? () => showEvents("warn") : null}
              info="Events marked as warnings: something went wrong but may have recovered. Click the number to see them."
            />
            {row.batches ? (
              MEASURES.map(([name, label, unit]) => (
                <Tile
                  key={name}
                  label={"Avg " + label}
                  value={number(metric(name)?.mean, 1) + unit}
                  info="Average of every per-second reading in this session. The Performance tab shows how it is worked out."
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
                  notes={EVENT_NOTES}
                  columns={[
                    "Time",
                    "Event",
                    "Level",
                    "Sent by",
                    "Connection",
                    "Error details",
                    "Message from the app",
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
                    [
                      e.error_code && "code " + e.error_code,
                      e.stage && "stage " + e.stage,
                      e.phase && "step " + e.phase,
                    ]
                      .filter(Boolean)
                      .join(" · ") || "—",
                    <details>
                      <summary>Show</summary>
                      <pre className="raw-event">
                        {[e.message, JSON.stringify(e.payload, null, 2)]
                          .filter(Boolean)
                          .join("\n\n")}
                      </pre>
                    </details>,
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
              notes={CONNECTION_NOTES}
              columns={[
                "Connection",
                "Role",
                "Sent by",
                "First event",
                "Last event",
                "Attempts",
                "Connected",
                "Connection errors",
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
                <p>
                  The player app sends one reading per second for each
                  measurement. Average, lowest and highest are over those
                  seconds. Use the "i" buttons for how each is worked out.
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
                  rows={detail.metrics.map((m) => [
                    <>
                      {MEASUREMENTS[m.metric]?.[0] || m.metric}
                      <small>{MEASUREMENTS[m.metric]?.[1]}</small>
                    </>,
                    number(m.mean, 1),
                    number(m.minimum, 1),
                    number(m.maximum, 1),
                    number(m.valid),
                    number(m.missing),
                  ])}
                />
                <h4>
                  Every 10 seconds
                  <Info>
                    The app sends its readings in batches of about 10 seconds.
                    Each row is one batch; each number is the average of that
                    batch&apos;s readings.
                  </Info>
                </h4>
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
    </dialog>
  );
}
