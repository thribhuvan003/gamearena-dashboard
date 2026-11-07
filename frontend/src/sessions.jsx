import React, { useEffect, useState } from "react";
import { number, Notice } from "./sections";
import { getReport } from "./api";

const categories = {
  all: "All observed sessions",
  attempted: "Connection attempted",
  success: "Recorded success",
  failure: "Recorded failure",
  no_success: "Attempted, no success",
  both: "Success and failure",
  success_only: "Success only",
  failure_only: "Failure only",
  neither: "Neither result recorded",
  reconnected: "Reconnected",
  repeat_reconnect: "Repeated reconnections",
  disconnected: "Disconnected",
  ws_error: "WebSocket errors",
  repeated_attempts: "Repeated attempts",
  measured: "With statistics",
  missing_stats: "Without statistics",
  missing_end: "Start without end",
  readiness: "With readiness timing",
};

function time(value) {
  return value
    ? new Date(value).toLocaleString("en-GB", { timeZone: "UTC" })
    : "Not recorded";
}

function EvidenceTable({ columns, rows, label }) {
  return (
    <div className="table-scroll">
      <table aria-label={label}>
        <thead>
          <tr>
            {columns.map((col) => (
              <th scope="col" key={col}>
                {col}
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
      {!rows.length && <p>No matching records in these dates.</p>}
    </div>
  );
}

function Pages({ data, page, onChange, busy }) {
  if (!data) return null;
  return (
    <div className="preset-buttons">
      <button disabled={busy || page === 1} onClick={() => onChange(page - 1)}>
        Previous page
      </button>
      <span role="status">
        Page {page} · {number(data.total)} records
      </span>
      <button
        disabled={busy || page * data.page_size >= data.total}
        onClick={() => onChange(page + 1)}
      >
        Next page
      </button>
    </div>
  );
}

// Cancel stale requests so changing filters cannot replace newer evidence with older results.
function useEvidence(endpoint, params) {
  const [result, setResult] = useState({ loading: true });
  const key = JSON.stringify(params);
  useEffect(() => {
    if (!endpoint) {
      setResult({});
      return;
    }
    const controller = new AbortController();
    setResult({ loading: true });
    getReport(endpoint, JSON.parse(key), controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setResult({ data });
      })
      .catch((error) => {
        if (!controller.signal.aborted) setResult({ error: error.message });
      });
    return () => controller.abort();
  }, [endpoint, key]);
  return result;
}

export function SessionExplorer({ period, selection, revision }) {
  const groups = useEvidence("issues", {
    ...period,
    revision,
    refresh: revision ? "1" : "0",
  });
  const [selected, setSelected] = useState(null);
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState("errors");
  const [session, setSession] = useState(null);
  const [copyStatus, setCopyStatus] = useState("");
  useEffect(() => {
    setSelected(selection);
    setPage(1);
    setSession(null);
  }, [selection, period]);
  const result = useEvidence(selected ? "sessions" : null, {
    ...period,
    ...selected,
    page,
    sort,
    revision,
  });

  function openGroup(group) {
    setSelected(group);
    setPage(1);
    setSession(null);
    setCopyStatus("");
    requestAnimationFrame(() =>
      document
        .getElementById("affected-sessions")
        ?.scrollIntoView({ behavior: "smooth" }),
    );
  }

  async function copyId(id) {
    try {
      await navigator.clipboard.writeText(id);
      setCopyStatus("Session ID copied for your investigation or bug report.");
    } catch {
      setCopyStatus(
        "Copy is unavailable. Select and copy the session ID shown in the row.",
      );
    }
  }

  return (
    <section id="session-explorer" className="section-block">
      <h2>Which issues affect sessions?</h2>
      <p>
        Select an issue to see its affected sessions, then open the session
        evidence. No search or filter entry is needed.
      </p>
      <Notice {...groups} />
      {groups.data && (
        <>
          <p>
            <strong>{number(groups.data.total)} observed sessions</strong> in
            these dates. Each percentage is a share of this total. Groups
            overlap, so their counts must not be added.
          </p>
          <div className="findings-grid">
            {groups.data.groups.map((group) => (
              <article className="panel" key={group.category}>
                <h3>{group.title}</h3>
                <p>
                  <strong>What this means:</strong> {group.meaning}
                </p>
                <p>
                  <strong className="big-number">
                    {number(group.sessions)}
                  </strong>{" "}
                  sessions ·{" "}
                  {group.share == null
                    ? "No observations"
                    : number(group.share, 1) + "% of all observed sessions"}
                </p>
                {group.events != null && (
                  <p>
                    {number(group.events)} matching events. One session can
                    record several events.
                  </p>
                )}
                <p>
                  <strong>What to check:</strong> {group.explanation}
                </p>
                <button
                  disabled={!group.sessions}
                  onClick={() => openGroup(group)}
                >
                  View affected sessions
                </button>
              </article>
            ))}
          </div>
          <h3>Connection failures grouped by phase and stage</h3>
          <p>
            Each row counts distinct sessions with a failure at that phase and
            stage. A session can appear in several rows.
          </p>
          <EvidenceTable
            label="Issue groups by failure stage"
            columns={[
              "Failure phase / stage",
              "Affected sessions",
              "Failure events",
              "Investigate",
            ]}
            rows={groups.data.stages.map((row) => [
              row.phase + " / " + row.stage,
              number(row.sessions),
              number(row.events),
              <button
                onClick={() =>
                  openGroup({
                    category: "failure",
                    phase: row.phase,
                    stage: row.stage,
                    title: row.phase + " / " + row.stage,
                  })
                }
              >
                View sessions
              </button>,
            ])}
          />
          <h3>Recorded errors grouped by code</h3>
          <p>
            Error codes identify a recorded category. They do not establish a
            root cause. Counts include errors, socket errors and explicit
            pipeline failures with a code.
          </p>
          <EvidenceTable
            label="Issue groups by error code"
            columns={[
              "Error code",
              "Affected sessions",
              "Error events",
              "Investigate",
            ]}
            rows={groups.data.codes.map((row) => [
              row.error_code,
              number(row.sessions),
              number(row.events),
              <button
                onClick={() =>
                  openGroup({
                    category: "all",
                    error_code: row.error_code,
                    title: "Error code: " + row.error_code,
                  })
                }
              >
                View sessions
              </button>,
            ])}
          />
          {!groups.data.total && (
            <p>No session events were recorded for these dates.</p>
          )}
        </>
      )}
      {selected && (
        <article id="affected-sessions" className="panel session-detail">
          <button
            onClick={() => {
              setSelected(null);
              setSession(null);
            }}
          >
            Back to issue groups
          </button>
          <h3>
            {selected.title ||
              categories[selected.category] ||
              "Affected sessions"}
          </h3>
          {selected.stage && (
            <p>
              {selected.phase} / {selected.stage}
            </p>
          )}
          {selected.explanation && <p>{selected.explanation}</p>}
          <label className="session-order">
            <span>Sort affected sessions</span>
            <select
              aria-label="Order affected sessions"
              value={sort}
              onChange={(event) => {
                setSort(event.target.value);
                setPage(1);
              }}
            >
              <option value="errors">Most WebSocket errors</option>
              <option value="reconnects">Most reconnections</option>
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
            </select>
          </label>
          <Notice {...result} />
          {result.data && (
            <>
              <p>
                <strong>{number(result.data.total)} affected sessions</strong>.
                Open a session to inspect the recorded sequence.
              </p>
              <p>
                These sessions come from the imported snapshot. Open recorded
                session to inspect the events and measurements preserved here.
              </p>
              <p role="status">{copyStatus}</p>
              <EvidenceTable
                label="Affected sessions"
                columns={[
                  "Session ID",
                  "First event (UTC)",
                  "Recorded evidence",
                  "Open session",
                ]}
                rows={result.data.items.map((row) => [
                  <code className="session-id">{row.session_id}</code>,
                  time(row.first_seen),
                  <>
                    {row.tags.join(" · ")}
                    <small>
                      {number(row.failure_events)} failure events ·{" "}
                      {number(row.reconnects)} reconnects ·{" "}
                      {number(row.ws_errors)} WebSocket errors
                    </small>
                  </>,
                  <div className="preset-buttons">
                    <button onClick={() => copyId(row.session_id)}>
                      Copy session ID
                    </button>
                    <button onClick={() => setSession(row.session_id)}>
                      Open recorded session
                    </button>
                  </div>,
                ])}
              />
              <Pages
                data={result.data}
                page={page}
                onChange={setPage}
                busy={result.loading}
              />
            </>
          )}
          {session && (
            <SessionDetail
              key={session + JSON.stringify(period)}
              id={session}
              period={period}
              onClose={() => setSession(null)}
            />
          )}
        </article>
      )}
    </section>
  );
}

function SessionDetail({ id, period, onClose }) {
  const [whole, setWhole] = useState(false);
  const scope = { ...period, whole: whole ? "1" : "0" };
  const result = useEvidence("sessions/" + id, scope);
  const [tab, setTab] = useState("events");
  const [filters, setFilters] = useState({});
  const [page, setPage] = useState(1);
  const evidence = useEvidence(
    "sessions/" + id + "/" + (tab === "performance" ? "buckets" : "events"),
    { ...scope, ...filters, page },
  );
  const detail = result.data;
  const row = detail?.session;
  useEffect(() => {
    document
      .getElementById("session-detail")
      ?.scrollIntoView({ behavior: "smooth" });
  }, []);
  function filterEvents(event) {
    event.preventDefault();
    setFilters(Object.fromEntries(new FormData(event.currentTarget)));
    setPage(1);
  }
  return (
    <article id="session-detail" className="panel session-detail">
      <button onClick={onClose}>Close session details</button>
      <h3>Session investigation</h3>
      <button
        aria-pressed={whole}
        onClick={() => {
          setWhole(!whole);
          setPage(1);
        }}
      >
        {whole ? "Show selected dates only" : "Inspect whole recorded session"}
      </button>
      <p>
        {whole
          ? "Scope: whole recorded session, in UTC."
          : "Scope: selected report dates, in UTC. Boundaries may be clipped."}
      </p>
      <p className="session-id">{id}</p>
      <Notice {...result} />
      {detail && (
        <>
          <p>
            <strong>{row.tags.join(" · ") || "No classified outcome"}</strong>
          </p>
          <div className="metric-grid">
            {[
              ["Lifecycle", row.ended_at ? "End recorded" : "No end recorded"],
              [
                "Duration",
                row.duration_seconds == null
                  ? "Not determinable"
                  : number(row.duration_seconds, 1) + " seconds",
              ],
              ["Host connections", number(row.host_connections)],
              ["Client connections", number(row.client_connections)],
              ["Events", number(row.events)],
              [
                "Errors / warnings",
                number(row.errors) + " / " + number(row.warnings),
              ],
              ...["fps", "latency", "jitter", "bitrate"].map((name) => [
                name === "fps" ? "Mean FPS" : "Mean " + name,
                number(detail.metrics.find((m) => m.metric === name)?.mean, 2),
              ]),
            ].map(([label, value]) => (
              <div className="panel metric-card" key={label}>
                <h4>{label}</h4>
                <strong>{value}</strong>
              </div>
            ))}
          </div>
          <p>
            Host and client counts use distinct recorded connection IDs.
            Performance cards weight valid samples equally. FPS is
            frames/second; other units need producer confirmation.
          </p>

          <EvidenceTable
            label="Session evidence"
            columns={["Evidence", "Value", "Meaning"]}
            rows={[
              [
                "Lifecycle start / end (UTC)",
                time(row.started_at) + " / " + time(row.ended_at),
                "Recorded session_started and session_ended boundaries inside the selected dates.",
              ],
              [
                "Duration",
                row.duration_seconds == null
                  ? "Not determinable"
                  : number(row.duration_seconds, 1) + " seconds",
                "Last end minus first start. A clipped or incomplete history cannot establish full duration.",
              ],
              [
                "Connections / attempts",
                number(row.connections) + " / " + number(row.attempts),
                "Distinct non-missing connection IDs / pipeline attempt events.",
              ],
              [
                "Errors / warnings",
                number(row.errors) + " / " + number(row.warnings),
                "Event level error / warn, counted separately from pipeline failures.",
              ],
              [
                "Client connected / disconnected / reconnected",
                [row.client_connected, row.disconnects, row.reconnects]
                  .map((v) => number(v))
                  .join(" / "),
                "Event counts; a reconnect does not independently prove a successful stream.",
              ],
              [
                "Statistics batches",
                number(row.batches),
                "Buckets starting inside the selected dates; absent measurements are never zero.",
              ],
              [
                "Device / OS",
                detail.devices,
                "No identity or location is inferred.",
              ],
            ]}
          />
          <p className="method-note">
            Diagnosis follows the evidence: success means a pipeline success
            event; failure means an explicit pipeline failure. Their order is
            shown below. Repeated events can reflect retries. These tags do not
            establish root cause.
          </p>
          <div
            className="tabs"
            role="tablist"
            aria-label="Session investigation tabs"
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
              <form className="session-filters" onSubmit={filterEvents}>
                <label>
                  Source
                  <select name="source" defaultValue={filters.source || ""}>
                    <option value="">All sources</option>
                    {[
                      ...new Set(
                        detail.connections.map((c) => c.source).filter(Boolean),
                      ),
                    ].map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Level
                  <select name="level" defaultValue={filters.level || ""}>
                    <option value="">All levels</option>
                    {["info", "warn", "error", "debug"].map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Connection
                  <select
                    name="connection"
                    defaultValue={filters.connection || ""}
                  >
                    <option value="">All connections</option>
                    <option value="missing">Missing connection ID</option>
                    {[
                      ...new Set(
                        detail.connections
                          .map((c) => c.connection_id)
                          .filter(Boolean),
                      ),
                    ].map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                </label>
                <button>Filter events</button>
              </form>
              <p>
                Oldest events first, ordered by timestamp and event ID for ties.
                Approved diagnostic fields appear here; free-text messages and
                arbitrary payloads stay out of this view.
              </p>
              <Notice {...evidence} />
              {evidence.data && (
                <EvidenceTable
                  label="Session events"
                  columns={[
                    "Time (UTC)",
                    "Event",
                    "Source / role",
                    "Level",
                    "Connection ID",
                    "Phase / stage / error code",
                    "Ready timer (ms)",
                  ]}
                  rows={evidence.data.items.map((e) => [
                    time(e.recorded_at),
                    <>
                      {e.event_type}
                      <small>{e.pipeline_event}</small>
                    </>,
                    `${e.source || "—"} / ${e.connection_role || "—"}`,
                    e.level,
                    e.connection_id,
                    [e.phase, e.stage, e.error_code]
                      .filter(Boolean)
                      .join(" / ") || "Not recorded",
                    number(e.ready_ms, 2),
                  ])}
                />
              )}
            </>
          )}
          {tab === "connections" && (
            <>
              <p>
                Rows group connection ID, role and source. An ID under multiple
                sources is still one connection. Missing IDs cannot be
                attributed to an individual connection.
              </p>
              <EvidenceTable
                label="Session connections"
                columns={[
                  "Connection ID",
                  "Role / source",
                  "First / last event (UTC)",
                  "Attempts / successes / failures",
                  "Disconnects / reconnects",
                ]}
                rows={detail.connections.map((c) => [
                  c.connection_id || "Not recorded",
                  `${c.connection_role || "—"} / ${c.source || "—"}`,
                  time(c.first_seen) + " / " + time(c.last_seen),
                  [c.attempts, c.successes, c.failures]
                    .map((v) => number(v))
                    .join(" / "),
                  [c.disconnects, c.reconnects]
                    .map((v) => number(v))
                    .join(" / "),
                ])}
              />
            </>
          )}
          {tab === "performance" && (
            <>
              <p>
                Every non-negative finite numeric sample has equal weight. P05
                is the lower fifth percentile; variability is population
                standard deviation. Missing and invalid entries are excluded.
                FPS uses frames/second; other units need producer confirmation.
                Quality thresholds require that context.
              </p>
              <EvidenceTable
                label="Session performance summary"
                columns={[
                  "Measurement",
                  "Valid / null / invalid",
                  "Mean",
                  "Minimum / maximum",
                  "P05 / variability",
                ]}
                rows={detail.metrics.map((m) => [
                  m.metric,
                  [m.valid, m.missing, m.invalid]
                    .map((v) => number(v))
                    .join(" / "),
                  number(m.mean, 2),
                  number(m.minimum, 2) + " / " + number(m.maximum, 2),
                  number(m.p05, 2) + " / " + number(m.deviation, 2),
                ])}
              />
              <h4>Performance through the session</h4>
              <p>
                One row per statistics bucket. These are bucket averages, not
                individual sample timestamps. Buckets can cross the selected
                date boundary.
              </p>
              <Notice {...evidence} />
              {evidence.data && (
                <EvidenceTable
                  label="Session performance buckets"
                  columns={[
                    "Bucket start / end (UTC)",
                    "Recorded measurements · mean (valid samples)",
                  ]}
                  rows={evidence.data.items.map((b) => [
                    time(b.bucket_start) + " / " + time(b.bucket_end),
                    Object.entries(b.metrics || {})
                      .map(
                        ([name, m]) =>
                          `${name}: ${number(m.mean, 2)} (${number(m.valid)})`,
                      )
                      .join(" · ") || "No usable arrays",
                  ])}
                />
              )}
            </>
          )}
          {tab !== "connections" && (
            <Pages
              data={evidence.data}
              page={page}
              onChange={setPage}
              busy={evidence.loading}
            />
          )}
        </>
      )}
    </article>
  );
}
