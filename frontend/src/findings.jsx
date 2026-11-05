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
        Four questions for the selected dates. Each answer counts only what was
        recorded.
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
              ? `${number(sessions.no_success)} of ${number(sessions.attempted)} sessions that attempted to connect had no recorded success.`
              : "No connection attempts were recorded."}
            {stage
              ? ` The ${stage.stage} stage in the ${stage.phase} phase logged ${number(stage.events)} failure events across ${number(stage.sessions)} sessions, the highest event count for a stage and phase.`
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
              ? `${number(signals.repeated_reconnect_sessions)} of the ${number(signals.reconnect_sessions)} sessions that reconnected did so more than once. Together, all reconnecting sessions produced ${number(signals.reconnect_events)} reconnect events.`
              : "No client reconnection events were recorded."}
          </Finding>
        )}
        {ready && (
          <Finding
            title="How long does the readiness timer take?"
            next={
              ready.valid > 0 &&
              "Confirm when this timer starts and stops, then investigate the slower cases."
            }
          >
            {ready.valid
              ? `Half of the ${number(ready.valid)} valid timing records were at or below ${number(ready.median, 1)} ms; about 95% were at or below ${number(ready.p95, 1)} ms. These are readings, not people.`
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
      {!error && (!summary || !investigation || !performance) && (
        <p role="status">Preparing the remaining findings…</p>
      )}
    </section>
  );
}
