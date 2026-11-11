// The two charts under the headline cards: how sessions ended up, why some never got video,
// and how many sessions each error hit. Every bar opens the sessions it counts.
import React from "react";
import { number, plural } from "./format";
import {
  OUTCOME_COLOURS,
  RankedBars,
  StackedBar,
  reasonColour,
} from "./charts";

// Errors that stop or break a session, in plain words with the event name as sent.
// [filter key, plain words, as the telemetry names it]
const SESSION_ERRORS = [
  ["failure", "Connection error", "pipeline.connect.failure"],
  [
    "error_video_connection",
    "Video connection failed",
    "webrtc.connection.state = failed",
  ],
  [
    "error_network_route",
    "No network path to the host worked",
    "ice.connection.state = failed",
  ],
  ["error_dropped", "Connection dropped", "pipeline.connection.dropped"],
  [
    "error_channel_gave_up",
    "Gave up reconnecting to our server",
    "ws.reconnect.exhausted",
  ],
  ["error_decode", "Video couldn't be decoded", "media.decode.error"],
];

// Two charts, both in sessions, and every bar opens exactly the sessions it counts.
export function Charts({
  groups,
  reasons,
  reason,
  category,
  onOpen,
  onReason,
}) {
  // One part per outcome, in the fixed colour order, so the bar reads the same every day.
  const outcomes = Object.keys(OUTCOME_COLOURS).map((key) => ({
    key,
    label: groups[key].title,
    count: groups[key].count,
    colour: OUTCOME_COLOURS[key],
    active: category === key,
    onClick: () => onOpen(key),
  }));
  const total = outcomes.reduce((sum, part) => sum + part.count, 0);

  // Why each session that never got video stopped: one reason per session.
  const never = reasons
    .filter(
      ([text]) =>
        text.startsWith("Failed: ") || text.startsWith("No failure report"),
    )
    .map(([text, count]) => ({
      key: text,
      // The heading already says they never got video, so the label drops the
      // "Failed: " start; whether the app sent an error moves to a small tag.
      label: text
        .replace(/^(Failed|No failure report): /, "")
        .replace(/^./, (first) => first.toUpperCase()),
      tag: text.startsWith("Failed: ")
        ? "pipeline.connect.failure sent"
        : "no pipeline.connect.failure",
      count,
      colour: reasonColour(text),
      active: reason === text,
      onClick: () => onReason(text),
    }));
  const neverTotal = never.reduce((sum, row) => sum + row.count, 0);

  // Only errors that happened, most common first.
  const errors = SESSION_ERRORS.map(([key, label, sent]) => ({
    key,
    label,
    detail: sent,
    count: groups[key].count,
    active: category === key,
    onClick: () => onOpen(key),
  }))
    .filter((row) => row.count > 0)
    .sort((a, b) => b.count - a.count);
  // Two kinds of error kept out of the chart because they rarely hurt a session.
  // They are still counted in a note under it, one click away.
  const harmless = groups.error_route_attempt.count;
  const retries = groups.failure_after_end.count;

  return (
    <div className="charts">
      <section className="chart">
        <h3>What happened to {plural(total, "session")}</h3>
        <p className="chart-sub">
          Each session counts once. Click a part to see those sessions.
        </p>
        <StackedBar
          parts={outcomes}
          total={total}
          label="How sessions ended up"
        />
        {/* Only when some sessions never got video. */}
        {never.length > 0 && (
          <>
            <h3 className="chart-gap">
              Why {number(neverTotal)} never got video
            </h3>
            <p className="chart-sub">
              The furthest step each one reached, from its own events.
            </p>
            <RankedBars
              rows={never}
              total={neverTotal}
              label="Why sessions never got video"
            />
          </>
        )}
      </section>
      <section className="chart">
        <h3>Sessions hit by each error</h3>
        <p className="chart-sub">
          Sessions with the error before they ended. One session can have
          several, so rows can add up to more than the total.
        </p>
        {errors.length ? (
          <RankedBars rows={errors} label="Sessions hit by each error" />
        ) : (
          <p>No errors on these dates.</p>
        )}
        {/* The note names only the kinds that happened, joined by a dot when both did. */}
        {(harmless > 0 || retries > 0) && (
          <p className="chart-note">
            Not shown:{" "}
            {harmless > 0 && (
              <button
                type="button"
                className="link-button"
                onClick={() => onOpen("error_route_attempt")}
              >
                {plural(harmless, "session")} with ice.candidate.error
              </button>
            )}
            {harmless > 0 && " (one network path failed, usually harmless)"}
            {harmless > 0 && retries > 0 && " · "}
            {retries > 0 && (
              <button
                type="button"
                className="link-button"
                onClick={() => onOpen("failure_after_end")}
              >
                {plural(retries, "session")} with errors only after they ended
              </button>
            )}
            {retries > 0 && " (retries of a closed session)"}.
          </p>
        )}
      </section>
    </div>
  );
}
