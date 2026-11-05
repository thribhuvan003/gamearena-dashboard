import React, { useState } from "react";
import {
  columnHelp,
  fields,
  measurementHelp,
  metricHelp,
  metricNames,
  outcomeHelp,
} from "./guide";

// Use the same readable number format in cards, tables and explanations.
export function number(value, digits = 0) {
  return value == null
    ? "—"
    : Number(value).toLocaleString("en-IN", { maximumFractionDigits: digits });
}

// Display the database's UTC day consistently in every time zone.
export function dateLabel(day) {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

// Native disclosure controls work with touch and keyboards, without hover-only tooltips.
function Explanation({ children }) {
  return (
    <details className="explanation">
      <summary>How this is counted</summary>
      <p>{children}</p>
    </details>
  );
}

// Distinguish a request error from a successful report containing no events.
export function Notice({ error, loading, children }) {
  if (error)
    return (
      <p className="notice error" role="alert">
        {error}
      </p>
    );
  if (loading)
    return (
      <p className="notice" role="status">
        {children || "Updating this section…"}
      </p>
    );
  return null;
}

// On phones the labels repeat beside each value, so wide tables remain readable.
function Table({ columns, rows, label, className = "" }) {
  return (
    <div className={`table-scroll ${className}`}>
      {/* Keep definitions beside each table, with a touch-friendly control on phones. */}
      <details className="column-guide">
        <summary>What these columns mean</summary>
        <dl>
          {columns.map((column) => (
            <div key={column}>
              <dt>{column}</dt>
              <dd>{columnHelp[column]}</dd>
            </div>
          ))}
        </dl>
      </details>
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
              {row.map((cell, column) => (
                <td key={columns[column]} data-label={columns[column]}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Card({ label, value, note, explanation, accent = false }) {
  return (
    <article className={`stat ${accent ? "accent" : ""}`}>
      <h3>{label}</h3>
      <strong className="big-number">{value}</strong>
      <p>{note}</p>
      {explanation && <Explanation>{explanation}</Explanation>}
    </article>
  );
}

// Show the most recent seven dates first instead of drawing a graph or a very long table.
function DailyCounts({ rows }) {
  const [showAll, setShowAll] = useState(false);
  const latest = [...rows].reverse();
  const shown = showAll ? latest : latest.slice(0, 7);
  return (
    <details className="panel supporting">
      <summary>Daily session counts</summary>
      <p className="caption">
        Each session is counted once per UTC day. A session seen on several days
        appears on each day. Observed means any event was recorded. With success
        means at least one connection success event; with failure means at least
        one connection failure event. The same session can be in both columns.
      </p>
      {rows.length ? (
        <Table
          label="Daily session counts"
          columns={[
            "Date",
            "Observed sessions",
            "With success",
            "With failure",
          ]}
          rows={shown.map((row) => [
            dateLabel(row.day),
            number(row.sessions),
            number(row.succeeded),
            number(row.failed),
          ])}
        />
      ) : (
        <p className="empty">No session events in this period.</p>
      )}
      {rows.length > 7 && (
        <button onClick={() => setShowAll(!showAll)}>
          {showAll
            ? "Show latest 7 dates"
            : `Show all ${rows.length} recorded dates`}
        </button>
      )}
    </details>
  );
}

// Count sessions once in the headline and explain repeated events in the detailed tables.
export function SessionOverview({
  report,
  coverage,
  error,
  loading,
  exportReport,
  canExport,
}) {
  const counts = report?.counts;
  const signals = [
    [
      "disconnected",
      "Client disconnection",
      "A client disconnect event was recorded. Normal exits are included.",
    ],
    [
      "reconnected",
      "Client reconnection",
      "A client reconnect event was recorded. This does not mean every retry recovered.",
    ],
    [
      "repeated_attempts",
      "Repeated attempts",
      "More than one pipeline connection attempt was recorded for the session.",
    ],
    [
      "ws_error",
      "WebSocket errors",
      "A WebSocket error event was recorded. A session may still have connected.",
    ],
  ];

  return (
    <section id="overview" className="section-block">
      <div className="section-heading">
        <h2>Session overview</h2>
        <button onClick={exportReport} disabled={!canExport}>
          Download report CSV
        </button>
      </div>
      <Notice error={error} loading={loading}>
        Updating session counts for the selected dates…
      </Notice>
      <p className="section-intro">
        A session is one recorded usage session, identified by a session ID.
        Observed sessions have at least one event inside these dates; they are
        not necessarily new sessions or people. Success and failure refer to
        logged pipeline connection results, not the whole user's experience.
      </p>
      <div className="stats-grid">
        <Card
          label="Observed sessions"
          value={number(counts?.total)}
          note="Unique sessions, not unique people."
          explanation="We count each session ID once, even if it produced many events or connections."
        />
        <Card
          accent
          label="Recorded success"
          value={
            counts?.success_share == null ? "—" : `${counts.success_share}%`
          }
          note={`${number(counts?.succeeded)} sessions had a connection success event.`}
          explanation="Sessions with a pipeline success event divided by all observed sessions. This is not a count of users connected right now."
        />
        <Card
          label="Attempted, no success"
          value={number(counts?.no_success)}
          note="Needs follow-up; permanent failure is not proven."
          explanation="An attempt was recorded, but no success event appeared inside the selected dates. Events outside this range or missing logs can matter."
        />
        <Card
          label="Measured sessions"
          value={number(coverage?.sessions)}
          note={`${number(coverage?.rows)} statistics batches.`}
          explanation="Sessions with a measurement batch starting in this period. Performance results represent these measured sessions."
        />
      </div>
      <div className="two-columns">
        <article className="panel">
          <h3>Session outcomes</h3>
          <p className="caption">
            These four groups do not overlap. Together they add up to all
            observed sessions.
          </p>
          <Table
            label="Session outcomes"
            columns={["Recorded outcome", "Sessions"]}
            rows={
              counts?.groups.map((group) => [
                <>
                  <strong>{group.name}</strong>
                  <small>{outcomeHelp[group.name]}</small>
                </>,
                number(group.count),
              ]) || []
            }
          />
          <p className="caption">
            Both failure and success can occur in one session. These totals do
            not tell us their order.
          </p>
        </article>
        <article className="panel">
          <h3>Connection signals</h3>
          <p className="caption">
            These session counts overlap. They must not be added together.
          </p>
          <dl className="signals">
            {signals.map(([key, label, meaning]) => (
              <div key={key}>
                <dt>
                  {label}
                  <small>{meaning}</small>
                </dt>
                <dd>{number(counts?.[key])}</dd>
              </div>
            ))}
          </dl>
        </article>
      </div>
      <article className="panel">
        <h3>Where connection failures were recorded</h3>
        <p className="caption">
          {number(counts?.failed)} sessions had a failure event. A session can
          appear in more than one row. Failure events count every recorded
          pipeline connection failure; Sessions counts each affected session
          once per row. These are not unique failed connections.
        </p>
        <Table
          label="Failure stages"
          columns={["Phase and stage", "Failure events", "Sessions"]}
          rows={
            report?.failures.map((row) => [
              <>
                <strong>{row.stage}</strong>
                <small>{row.phase}</small>
              </>,
              number(row.events),
              number(row.sessions),
            ]) || []
          }
        />
        {counts && !report.failures.length && (
          <p className="empty">No pipeline failures recorded in this period.</p>
        )}
        <p className="caption">
          A stage shows where an event was recorded. It does not prove the root
          cause. For example, one session with three failure events and one
          success event counts as three failure events, one session with failure
          and one session with success.
        </p>
      </article>
      {report && <DailyCounts rows={report.trend} />}
    </section>
  );
}

// Different months can contain different sessions. Show comparisons without claiming a cause.
export function MonthlyComparison({ report }) {
  // Loading or failure is explained by the performance panel; it is not an empty result.
  if (!report) return null;
  const rows = report.monthly || [];
  const mean = (month, name) =>
    month.metrics.find((metric) => metric.metric === name)?.mean;
  return (
    <section className="section-block" aria-label="Monthly measurements">
      <h2>Month-by-month measurements</h2>
      <p className="section-intro">
        Only dates inside the selected period are included, so the first and
        last months may be partial. These are sample-weighted averages from the
        sessions measured in each month.
      </p>
      <article className="panel">
        <Table
          label="Monthly measurements"
          columns={[
            "Month",
            "Average FPS",
            "Average latency",
            "Average jitter",
            "FPS samples",
          ]}
          rows={rows.map((month) => [
            month.month,
            number(mean(month, "fps"), 2),
            number(mean(month, "latency"), 2),
            number(mean(month, "jitter"), 2),
            number(
              month.metrics.find((metric) => metric.metric === "fps")?.valid,
            ),
          ])}
        />
        {!rows.length && (
          <p className="empty">No monthly measurements in this period.</p>
        )}
        <p className="caption">
          Latency and jitter retain their recorded units. Changes in these
          averages do not prove that a product change caused a better or worse
          experience.
        </p>
      </article>
    </section>
  );
}

// Show only measured values. A dash means no usable reading; zero is a real reading.
export function Performance({ report, error, loading }) {
  return (
    <section id="performance" className="section-block">
      <div className="section-heading">
        <h2>Performance measurements</h2>
      </div>
      <p className="section-intro">
        These are recorded measurements from sessions with statistics. They do
        not represent every session.
      </p>
      <Notice error={error} loading={loading}>
        Preparing measurement summaries. The first calculation reads the stored
        samples; later date changes reuse daily totals.
      </Notice>
      <div className="metric-grid">
        {Object.entries(metricNames).map(([key, label]) => {
          const metric = report?.metrics.find((row) => row.metric === key);
          return (
            <article className="panel metric-card" key={key}>
              <h3>{label}</h3>
              <strong className="big-number">{number(metric?.mean, 2)}</strong>
              <p>
                {key === "fps"
                  ? "Average frames per second"
                  : "Average in recorded units — definition needs confirmation"}
              </p>
              <p className="caption">{metricHelp[key]}</p>
              {/* Keep sample checks available without competing with the performance result. */}
              <details className="explanation">
                <summary>How this average was calculated</summary>
                <dl className="metric-details">
                  <div>
                    <dt>Numeric samples</dt>
                    <dd>{number(metric?.valid)}</dd>
                  </div>
                  <div>
                    <dt>Minimum / maximum</dt>
                    <dd>
                      {number(metric?.minimum, 2)} /{" "}
                      {number(metric?.maximum, 2)}
                    </dd>
                  </div>
                  <div>
                    <dt>Null / invalid entries</dt>
                    <dd>
                      {number(metric?.missing)} / {number(metric?.invalid)}
                    </dd>
                  </div>
                </dl>
                <p>
                  Every valid numeric reading has equal weight in the average.
                  Minimum and maximum are the lowest and highest valid readings.
                  Null means missing; invalid means a rejected value. Neither is
                  changed to zero. These sample counts are not session counts.
                </p>
              </details>
            </article>
          );
        })}
      </div>
      <details className="panel supporting">
        <summary>See all recorded measurement fields</summary>
        <p className="caption">
          {number(report?.inventory.length)} fields found in this period.
          Additional frame, queue or other fields appear only when recorded.
        </p>
        <Table
          label="All measurement fields"
          columns={[
            "Field and meaning",
            "Array batches",
            "Numeric samples",
            "Average",
            "Minimum / maximum",
            "Null / invalid",
          ]}
          rows={
            report?.inventory.map((field) => {
              const metric = report.metrics.find(
                (row) => row.metric === field.metric,
              );
              return [
                <>
                  <strong>{field.metric}</strong>
                  <small>{measurementHelp(field.metric)}</small>
                </>,
                number(field.array_rows),
                number(metric?.valid),
                number(metric?.mean, 2),
                `${number(metric?.minimum, 2)} / ${number(metric?.maximum, 2)}`,
                `${number(metric?.missing)} / ${number(metric?.invalid)}`,
              ];
            }) || []
          }
        />
        {report && !report.inventory.length && (
          <p className="empty">
            No measurement fields recorded in this period.
          </p>
        )}
      </details>
      <p className="method-note">
        <strong>How the averages work:</strong> every non-negative, finite
        numeric sample has equal weight. Null and invalid entries are excluded,
        not changed to zero. Producer-specific units and counter meanings need
        confirmation before assigning good/bad thresholds. Bitrate is not total
        data consumption.
      </p>
    </section>
  );
}

// Present evidence and its limits together, so event totals are not mistaken for failed users.
export function Investigation({ report, error, loading }) {
  const counts = report?.counts;
  const readiness = report?.readiness;
  const purpose = {
    errorCode:
      "Group technical error categories; the code alone does not prove session failure.",
    timeToReadyMs: "Study the producer-reported readiness timing.",
    delayMs:
      "Study delays attached to logged operations; not a complete user-wait measurement.",
    attempt:
      "Study logged attempt counters alongside actual connection-attempt events.",
    stage: "Locate the processing step where an event was recorded.",
  };

  return (
    <section id="investigation" className="section-block">
      <details className="panel supporting">
        <summary>
          Supporting evidence: errors, session logging and timing
        </summary>
        <Notice error={error} loading={loading}>
          Checking event patterns and matching sessions to statistics…
        </Notice>
        <article className="panel">
          <h3>What deserves a closer look?</h3>
          <Table
            label="Investigation evidence"
            columns={["Topic", "Recorded evidence", "What to check next"]}
            rows={[
              [
                "WebSocket errors",
                <>
                  <strong>
                    {number(counts?.ws_error_events)} events ·{" "}
                    {number(counts?.ws_error_sessions)} sessions
                  </strong>
                  <small>
                    {number(counts?.repeated_error_sessions)} sessions had
                    repeated errors. Maximum in one session:{" "}
                    {number(counts?.max_errors_in_one_session)}.
                  </small>
                </>,
                "Review error timing and session outcomes. An error event is not a failed connection count.",
              ],
              [
                "Reconnections",
                <>
                  <strong>
                    {number(counts?.reconnect_events)} events ·{" "}
                    {number(counts?.reconnect_sessions)} sessions
                  </strong>
                  <small>
                    {number(counts?.repeated_reconnect_sessions)} sessions had
                    repeated reconnections. Maximum in one session:{" "}
                    {number(counts?.max_reconnects_in_one_session)}.
                  </small>
                </>,
                "Separate normal reconnect behavior from unexpected interruptions using session histories.",
              ],
              [
                "Performance coverage",
                <>
                  <strong>
                    {number(counts?.matched_statistics)} event sessions matched
                    statistics
                  </strong>
                  <small>
                    {number(counts?.without_statistics)} had no statistics batch
                    starting inside this period.
                  </small>
                </>,
                "Check collection rules and logging gaps. Missing measurements do not prove that a session failed.",
              ],
              [
                "Session end logging",
                <>
                  <strong>
                    {number(counts?.started_without_end)} sessions recorded a
                    start without an end
                  </strong>
                  <small>
                    {number(counts?.start_events)} start events ·{" "}
                    {number(counts?.end_events)} end events.
                  </small>
                </>,
                "Review lifecycle logging and date boundaries. This is not a confirmed crash count.",
              ],
              [
                "Connections per session",
                <>
                  <strong>
                    {number(counts?.connection_ids)} distinct connection IDs
                  </strong>
                  <small>
                    {number(counts?.several_connection_sessions)} sessions had
                    several IDs. Maximum in one session:{" "}
                    {number(counts?.max_connections_in_one_session)}.
                  </small>
                </>,
                "Confirm the host/client relationship. Every additional connection must not be labelled a retry.",
              ],
            ]}
          />
          <p className="caption">
            The statistics match uses session IDs inside the database. No actual
            IDs are displayed. Matches refer only to records inside the selected
            period.
          </p>
        </article>
        <div className="two-columns">
          <article className="panel">
            <h3>Reported readiness time</h3>
            <p className="caption">
              From the producer field <code>timeToReadyMs</code>. The name
              denotes milliseconds; confirm when this timer starts and ends
              before treating it as the full user wait.
            </p>
            <Table
              label="Readiness timing"
              columns={["Measure", "Recorded value", "Meaning"]}
              rows={[
                [
                  "Numeric records",
                  number(readiness?.valid),
                  `${number(readiness?.entries)} records contained the field; other entries are excluded.`,
                ],
                [
                  "Median",
                  number(readiness?.median, 2),
                  "Half of the numeric readiness values are at or below this value.",
                ],
                [
                  "95th percentile",
                  number(readiness?.p95, 2),
                  "About 95% of numeric readiness values are at or below this value.",
                ],
                [
                  "Average",
                  number(readiness?.mean, 2),
                  "All included values have equal weight. Large values can pull the average up.",
                ],
              ]}
            />
          </article>
          <article className="panel">
            <h3>Useful payload fields</h3>
            <p className="caption">
              Field occurrences are event counts, not unique users or confirmed
              failures.
            </p>
            <Table
              label="Payload field coverage"
              columns={["Field and purpose", "Occurrences", "Sessions"]}
              rows={
                report?.payload.map((row) => [
                  <>
                    <code>{row.field}</code>
                    <small>{purpose[row.field]}</small>
                  </>,
                  number(row.occurrences),
                  number(row.sessions),
                ]) || []
              }
            />
          </article>
        </div>
        <p className="method-note">
          <strong>Unique users remain unknown.</strong> This report has no
          approved account-to-session mapping. Session IDs cannot be presented
          as a count of real people or returning users.
        </p>
      </details>
    </section>
  );
}

// Explain names and limitations without displaying private IDs or diagnostic contents.
export function DataGuide() {
  const [table, setTable] = useState("Events");
  return (
    <section id="data-guide" className="section-block">
      <h2>The data, explained</h2>
      <div className="guide-grid">
        <article className="panel">
          <h3>What is a session?</h3>
          <p>
            One product usage session. Its session ID groups the related
            records. A session is not the same as a unique person.
          </p>
        </article>
        <article className="panel">
          <h3>What is a connection?</h3>
          <p>
            A connection is a link within a session. A session can create
            several connections and retry, so connection counts differ from
            session counts.
          </p>
        </article>
        <article className="panel">
          <h3>Events and statistics</h3>
          <p>
            Events describe what happened. Statistics store batches of
            measurements. Many records can belong to one session.
          </p>
        </article>
      </div>
      <article className="panel dictionary">
        <h3>What each column means</h3>
        <div className="tabs" role="tablist" aria-label="Data definitions">
          {Object.keys(fields).map((name) => (
            <button
              key={name}
              role="tab"
              aria-selected={table === name}
              onClick={() => setTable(name)}
            >
              {name}
            </button>
          ))}
        </div>
        {table === "Payload fields" && (
          <p className="caption">
            Payload fields are optional and vary by event. Missing information
            is not treated as zero or success.
          </p>
        )}
        <Table
          label={`${table} definitions`}
          columns={["Column", "Plain meaning", "How to read it"]}
          rows={fields[table].map(([field, label, meaning]) => [
            <code>{field}</code>,
            label,
            meaning,
          ])}
        />
      </article>
      <div className="guide-grid">
        <article className="panel">
          <h3>Which dates are included?</h3>
          <p>
            Both selected dates are included, in UTC. Events use their recorded
            time. Statistics use batch start; an edge batch may cross the
            selected boundary.
          </p>
        </article>
        <article className="panel">
          <h3>What can these totals prove?</h3>
          <p>
            Success, failure, disconnect and reconnect can overlap. Totals alone
            do not prove a permanent failure, event order or root cause.
          </p>
        </article>
        <article className="panel">
          <h3>How do new months appear?</h3>
          <p>
            Import compatible data into the existing tables, then use Refresh
            and All data. The application discovers the available dates from the
            database.
          </p>
        </article>
      </div>
    </section>
  );
}
