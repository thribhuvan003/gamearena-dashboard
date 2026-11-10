import React, { useEffect, useRef, useState } from "react";
import { useReport } from "./api";
import { Info, Notice, Pages, number, utcTime } from "./format";

// Units are not documented by the client; these match the value ranges in the data.
const MEASURES = [
  ["fps", "FPS", ""],
  ["latency", "delay", " ms"],
  ["jitter", "delay variation", " ms"],
  ["bitrate", "video data rate", " Mbps"],
];

// Every measurement the player app sends. Checked in the data: readings are 1,000 ms apart,
// 10 per batch, and none is a running total (each goes up and down). Exact definitions and
// units live in the player app's code, so anything not checked here says so.
const MEASUREMENTS = {
  fps: [
    "Frames per second",
    "Video frames in that second, as the player app reports them. Always a whole number. 30 is the idle rate.",
  ],
  latency: [
    "Delay (ms)",
    "Delay between player and host in that second, as the app reports it. Whether it is one way or the round trip is not documented.",
  ],
  jitter: [
    "Delay variation (ms)",
    "How much the delay varied in that second, as the app reports it.",
  ],
  bitrate: ["Video data rate (Mbps)", "Video data received in that second."],
  downloadSpeed: [
    "Download speed (Mbps)",
    "The player's download speed in that second, as the app measures it.",
  ],
  decodeDuration: [
    "Time to show a frame (ms)",
    "How long the player took to get a frame ready to show, in that second.",
  ],
  encodeDuration: [
    "Time to prepare a frame (ms)",
    "How long the host took to prepare a frame to send, in that second.",
  ],
  skippedFrames: [
    "Skipped frames",
    "Frames skipped (not shown) in that second. A count for that second, not a running total.",
  ],
  accumulatedFrames: [
    "Accumulated frames",
    "The app's own measure; its exact meaning is not documented. Not a running total and often a fraction, so likely an average within the second. Around 1 is typical in this data.",
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
export const EVENTS = {
  "pipeline.connect.attempt": "Tried to connect",
  "pipeline.connect.success": "Connected, video started",
  "pipeline.connect.failure": "Connection error",
  "pipeline.connection.dropped": "Connection dropped",
  "media.decode.error": "Video could not be decoded",
  "ice.connection.state": "Network path changed",
  "media.first_decode": "First video frame",
  "webrtc.connection.state": "Video connection changed",
  "ice.candidate.error": "One network path failed (usually harmless)",
  "ice.gathering.complete": "Network paths found",
  "ice.restart": "Network path restarted",
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
const LEVELS = { error: "Error", warn: "Warning", info: "Normal" };
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
    "What the player app measured, with the app's own field name underneath. Units are read from the value ranges; the team should confirm them.",
  Average:
    "The mean: add up every reading and divide by how many there are. One reading per second, for this session on the selected dates. If two players report in the same second, both readings count; that is rare (about 0.03% of seconds).",
  Lowest: "The lowest single reading, so the worst or best one second.",
  Highest: "The highest single reading, so the worst or best one second.",
  "Seconds measured":
    "How many readings were used. Readings are 1 second apart, so 60 is one minute of streaming.",
  "Seconds with no value":
    "Seconds where the value was empty or not a usable number. They are left out of the average.",
};
const EVENT_NOTES = {
  "What happened": "What happened, in plain words.",
  "App's event name": "The name the app itself gives this event.",
  Level:
    "Error: something failed. Warning: something went wrong but may have recovered. Normal: everyday activity.",
  "Sent by":
    "Which side logged the event: the server, the player app or the host.",
  Connection: "The connection the event belongs to, if any.",
  "Error details":
    "The code, the part of the app (stage) and the step, exactly as the app sent them.",
  "Message from the app":
    "The event exactly as the app sent it, unchanged: its message and every field.",
  "Time to video":
    "On a successful connect: time from connecting to the first video frame.",
};

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
  "Time to video",
]);

function DataTable({
  columns: allColumns,
  rows: allRows,
  label,
  empty,
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
      {!rows.length && <p>{empty || "Nothing recorded on these dates."}</p>}
    </div>
  );
}

// A summary tile. Tiles with an action open the matching events below.
function Tile({ label, value, onOpen, info, sub }) {
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

const TECHNICAL_KEY = "gamearena.technical";
const TABS = [
  ["events", "What happened"],
  ["performance", "Stream quality"],
  ["connections", "Connections"],
];

// How the server says a session ended, in plain words. The app's own value shows in technical details.
const ENDINGS = {
  "Device deleted": "gaming server removed",
  "Not in use": "closed while not in use",
  "Ended by user": "ended by the user",
};

// Stream quality in one sentence: only facts measured in this session.
function verdict(metrics, batches) {
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
const QUALITY_TILES = [
  [
    "fps",
    "Frames per second",
    "",
    (m) => `${number((m.under_30 / m.valid) * 100, 1)}% of the time under 30`,
  ],
  [
    "latency",
    "Delay",
    "\u00a0ms",
    (m) => `Worst second: ${number(m.maximum, 0)}\u00a0ms`,
  ],
  [
    "downloadSpeed",
    "Download speed",
    "\u00a0Mbps",
    (m) => `Lowest: ${number(m.minimum, 1)}\u00a0Mbps`,
  ],
  [
    "bitrate",
    "Video data rate",
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

// Events: plain columns for everyone; the app's own names and raw messages only with technical details.
function EventTable({ items, technical }) {
  const days = new Set(items.map((e) => utcTime(e.recorded_at).split(",")[0]));
  const oneDay = days.size === 1;
  const time = (value) =>
    oneDay ? utcTime(value, true).split(", ")[1] : utcTime(value, true);
  return (
    <>
      {oneDay && items.length > 0 && (
        <p className="table-note">All on {[...days][0]} (UTC).</p>
      )}
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
            ? [
                "App's event name",
                "Connection",
                "Error details",
                "Message from the app",
              ]
            : []),
        ]}
        rows={items.map((e) => [
          time(e.recorded_at),
          EVENTS[e.pipeline_event || e.event_type] ||
            e.pipeline_event ||
            e.event_type,
          <span className={"chip " + e.level}>
            {LEVELS[e.level] || e.level}
          </span>,
          plain(e.source, WHO_SENT),
          ...(technical
            ? [
                <code>{e.pipeline_event || e.event_type}</code>,
                e.connection_id || "—",
                [
                  e.error_code && "code " + e.error_code,
                  e.stage && "stage " + e.stage,
                  e.phase && "phase " + e.phase,
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
              ]
            : []),
        ])}
      />
    </>
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
  // Engineers switch this on once; the choice is remembered on this computer.
  const [technical, setTechnical] = useState(() => {
    try {
      return localStorage.getItem(TECHNICAL_KEY) === "1";
    } catch {
      return false;
    }
  });
  function showTechnical(on) {
    setTechnical(on);
    if (!on)
      setTab((current) => (current === "connections" ? "events" : current));
    try {
      localStorage.setItem(TECHNICAL_KEY, on ? "1" : "0");
    } catch {
      // Private windows can block storage; the switch still works for this visit.
    }
  }
  const [copied, setCopied] = useState(false);
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
    performance:
      row?.batches && technical ? "sessions/" + id + "/buckets" : null,
  }[tab];
  const list = useReport(pagedName, { ...scope, ...filters, page });
  const metric = (name) => detail.metrics.find((m) => m.metric === name);
  const dialog = useRef(null);

  // Opens as a pop-up over the list. Esc, the Close button or a click outside closes it.
  useEffect(() => {
    dialog.current?.showModal();
    dialog.current?.querySelector("h2")?.focus();
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
      <header className="detail-head">
        <h2 tabIndex={-1} className="panel-title">
          Session{" "}
          <code className="session-id" title={id}>
            {id.slice(0, 8)}…
          </code>
        </h2>
        <button
          className="copy-id"
          onClick={() =>
            navigator.clipboard?.writeText(id).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            })
          }
        >
          {copied ? "Copied" : "Copy ID"}
        </button>
        <label className="switch">
          <input
            type="checkbox"
            checked={technical}
            onChange={(event) => showTechnical(event.target.checked)}
          />
          Technical details
        </label>
        <button className="close" onClick={() => dialog.current.close()}>
          Close
        </button>
      </header>
      <div className="date-bar">
        <span>Showing</span>
        <div
          className="segmented"
          role="group"
          aria-label="Which dates to show"
        >
          {[
            [false, "Selected dates"],
            [true, "Whole session"],
          ].map(([value, label]) => (
            <button
              key={label}
              aria-pressed={whole === value}
              onClick={() => {
                setWhole(value);
                setPage(1);
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <Notice {...result} />

      {detail && (
        <>
          <p className="detail-story">
            <strong>{row.why || "Not worked out yet"}</strong>
            {row.end_reason &&
              ` · Ended: ${ENDINGS[row.end_reason] || row.end_reason}`}
            <Info topic="How far it got">
              How far this session got, in plain words, and why the server
              closed it. &quot;Gaming server removed&quot; means the cloud
              gaming server was taken away, by the provider or during a test, so
              it is not an error in the session.
            </Info>
          </p>
          {row.last_error_message && (
            <p className="app-said">
              What the app said: <q>{row.last_error_message}</q>
            </p>
          )}
          <div className="metric-grid">
            {row.first_ready_ms != null && (
              <Tile
                label="Time to video"
                info="Time from connecting to the first video frame, for the first successful connect."
                value={number(row.first_ready_ms / 1000, 1) + "\u00a0s"}
              />
            )}
            <Tile
              label="Duration"
              value={duration(row)}
              info="End minus start. With no end recorded, it runs to the last event, so it is a minimum."
            />
            <Tile
              label="Attempts"
              value={number(row.attempts)}
              info="How many times the app tried to connect."
            />
            <Tile
              label="Error events"
              value={number(row.errors)}
              onOpen={row.errors ? () => showEvents("error") : null}
              info="Events the app marked as errors. Click the number to see them."
            />
          </div>
          <p className="verdict">{verdict(detail.metrics, row.batches)}</p>
          <details>
            <summary>More numbers</summary>
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
                label="Player joins"
                value={number(row.client_connections)}
                info="How many times a player joined. Someone who leaves and comes back counts again, so this counts joins, not people."
              />
              <Tile
                label="Lost video while playing"
                value={number(row.stream_drops)}
                info="Times the video connection went from connected to lost while playing."
              />
              <Tile
                label="Players who left"
                value={number(row.disconnects)}
                info="Times a player left."
              />
              <Tile
                label="Players who came back"
                value={number(row.reconnects)}
                info="Times a player came back."
              />
              <Tile
                label="Warnings"
                value={number(row.warnings)}
                onOpen={row.warnings ? () => showEvents("warn") : null}
                info="Events marked as warnings: something went wrong but may have recovered. Click the number to see them."
              />
            </div>
          </details>
          {technical && (
            <p className="technical-note">
              Appears in (whole session): {row.tags.join(" · ") || "—"}
            </p>
          )}

          <div
            className="tabs"
            role="tablist"
            aria-label="Session sections"
            ref={tabs}
          >
            {TABS.filter(([name]) => technical || name !== "connections").map(
              ([name, label]) => (
                <button
                  key={name}
                  role="tab"
                  aria-selected={tab === name}
                  onClick={() => {
                    setTab(name);
                    setPage(1);
                  }}
                >
                  {label}
                </button>
              ),
            )}
          </div>

          {tab === "events" && (
            <>
              {/* The key resets the form when a tile sets a filter. */}
              <form
                className="session-filters"
                key={JSON.stringify(filters)}
                onSubmit={filterEvents}
                onChange={(event) => event.currentTarget.requestSubmit()}
              >
                <label>
                  Level
                  <select name="level" defaultValue={filters.level || ""}>
                    <option value="">All</option>
                    {["error", "warn", "info"].map((level) => (
                      <option key={level} value={level}>
                        {LEVELS[level]}
                      </option>
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
                {technical && (
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
                )}
              </form>
              <Notice {...list} />
              {list.data && (
                <EventTable items={list.data.items} technical={technical} />
              )}
            </>
          )}

          {tab === "connections" && technical && (
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
                <div className="metric-grid">
                  {QUALITY_TILES.map(([name, label, unit, describe]) => {
                    const m = metric(name);
                    return (
                      m && (
                        <Tile
                          key={name}
                          label={label}
                          value={number(m.mean, 1) + unit}
                          sub={describe(m)}
                          info={MEASUREMENTS[name][1]}
                        />
                      )
                    );
                  })}
                </div>
                {technical && (
                  <>
                    <p>
                      The player app records one reading per second for each
                      measurement and sends them in groups of 10. Each reading
                      is that second&apos;s own value, not a running total.
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
                          <small>{m.metric}</small>
                        </>,
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
                        Each row is one group of 10 readings; each number is the
                        average of that group.
                      </Info>
                    </h3>
                    <Notice {...list} />
                    {list.data && (
                      <DataTable
                        label="Session stats batches"
                        columns={[
                          "Start",
                          "End",
                          ...Object.values(MEASUREMENTS).map(
                            ([title]) => title,
                          ),
                        ]}
                        rows={list.data.items.map((b) => [
                          utcTime(b.bucket_start, true),
                          utcTime(b.bucket_end, true),
                          ...Object.keys(MEASUREMENTS).map((name) =>
                            b.metrics?.[name]
                              ? number(b.metrics[name].mean, 1)
                              : "—",
                          ),
                        ])}
                      />
                    )}
                  </>
                )}
              </>
            ) : (
              <p>
                The player app sent no stream readings for this session, so
                there is nothing to show here.
              </p>
            ))}

          {(tab === "events" ||
            (tab === "performance" && technical && row.batches > 0)) && (
            <Pages
              data={list.data}
              page={page}
              onChange={setPage}
              busy={list.loading}
              noun={tab === "events" ? "events" : "groups of 10 readings"}
            />
          )}
        </>
      )}
    </dialog>
  );
}
