import React from "react";
import { number } from "./sections";

// Pair each observation with the next product question, without guessing a cause.
function Finding({ title, children, next }) {
  return (
    <article className="panel finding">
      <h3>{title}</h3>
      <p>{children}</p>
      {next && (
        <p>
          <strong>Check next:</strong> {next}
        </p>
      )}
    </article>
  );
}

// Keep the month in UTC, even when the reader's laptop uses another time zone.
function monthLabel(month) {
  return new Date(`${month}-01T00:00:00Z`).toLocaleDateString("en-GB", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

// SQL and Python have already counted the sessions and calculated the averages.
export function Findings({ summary, investigation, performance, error }) {
  const sessions = summary?.counts;
  const signals = investigation?.counts;
  const ready = investigation?.readiness;
  // The SQL orders phase/stage rows by failure event count, including repeat events.
  const stage = summary?.failures[0];
  // Each failure belongs to exactly one stage/phase row. Session counts can overlap.
  const failures = summary?.failures.reduce((sum, row) => sum + row.events, 0);
  const missingId = summary?.failures.reduce((sum, row) => sum + row.missing_id, 0);
  // Called only for a positive denominator. Round only the displayed percentage.
  const share = (part, total) => number(100 * part / total, 1) + "%";
  // A change in frame rate needs two months with actual, valid FPS readings.
  const months = (performance?.monthly || [])
    .map((row) => ({
      month: monthLabel(row.month),
      fps: row.metrics.find((item) => item.metric === "fps")?.mean,
    }))
    .filter((row) => row.fps != null);
  const previous = months.at(-2);
  const latest = months.at(-1);

  return (
    <section id="findings" className="section-block">
      <h2>Product findings</h2>
      <p className="section-intro">
        Each percentage uses events or sessions from the selected dates.
      </p>
      {error && (
        <p className="notice error" role="alert">
          Some findings are unavailable. {error}
        </p>
      )}
      <div className="findings-grid">
        {summary && (
          <Finding
            title="Where does connection setup need attention?"
            next={
              stage &&
              "Start with this phase and stage. A logged failure shows where to look, not why it happened."
            }
          >
            {sessions.attempted
              ? `${share(sessions.no_success, sessions.attempted)} of sessions that attempted to connect had no recorded success (${number(sessions.no_success)} of ${number(sessions.attempted)}).`
              : "No connection attempts were recorded."}
            {stage
              ? ` ${share(stage.events, failures)} of failure events were logged at ${stage.stage} (${stage.phase}): ${number(stage.events)} of ${number(failures)} events, across ${number(stage.sessions)} sessions.`
              : " No connection failure events were recorded."}
          </Finding>
        )}
        {signals && (
          <Finding
            title="Do the same sessions keep reconnecting?"
            next={
              signals.reconnect_sessions > 0 &&
              "Review the reconnect flow in repeat cases. A reconnect alone does not tell us whether an interruption was unexpected."
            }
          >
            {signals.reconnect_sessions
              ? `${share(signals.repeat_events, signals.reconnect_events)} of reconnect events came from sessions that reconnected more than once (${number(signals.repeat_events)} of ${number(signals.reconnect_events)} events). This group contained ${number(signals.repeated_reconnect_sessions)} of the ${number(signals.reconnect_sessions)} reconnecting sessions.`
              : "No client reconnection events were recorded."}
          </Finding>
        )}
        {/* Convert the stored milliseconds to seconds for the founder's view. */}
        {ready && (
          <Finding
            title="How long does the readiness timer take?"
            next={
              ready.valid > 0 &&
              "Confirm when this timer starts and stops, then investigate the slower cases."
            }
          >
            {ready.valid
              ? `Across ${number(ready.valid)} timer readings, the median was ${number(ready.median / 1000, 2)} seconds. About 95% of readings were at or below ${number(ready.p95 / 1000, 2)} seconds.`
              : "No valid readiness timing was recorded for these dates."}
          </Finding>
        )}
        {performance && (
          <Finding
            title="Did measured frame rate change?"
            next={
              previous &&
              "Compare the same devices and releases before attributing a change to the product. These months may cover different days and sessions."
            }
          >
            {previous
              ? `Average frame rate was ${number(previous.fps, 1)} FPS in ${previous.month} and ${number(latest.fps, 1)} FPS in ${latest.month}, the two latest months with readings in this selection.`
              : latest
                ? `Average frame rate was ${number(latest.fps, 1)} FPS in ${latest.month}. A second month with readings is needed for a comparison.`
                : "No valid frame-rate readings were recorded for these dates."}
          </Finding>
        )}
      </div>
      {failures > 0 && (
        <p className="method-note">
          <strong>Can we trace a failure to its connection?</strong>{" "}
          {share(missingId, failures)} of failure events lacked a connection ID
          {" "}({number(missingId)} of {number(failures)}).
          {missingId > 0 && " For those events, the session and stage are available for investigation. Recording the connection ID when one exists would make individual attempts easier to trace."}
        </p>
      )}
      {!error && (!summary || !investigation || !performance) && (
        <p role="status">Preparing the remaining findings…</p>
      )}
    </section>
  );
}
