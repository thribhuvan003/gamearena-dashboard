// The headline sentence and the cards: one card's look, the props every card is built from,
// and the five headline cards with their trend lines.
import React from "react";
import { Info, number, plural } from "../lib/format";
import { Sparkline } from "./charts";
import {
  MIN_SESSIONS,
  RELATIVE_NOISE,
  countNoise,
  dailyNoise,
  shareNoise,
} from "../lib/helpers";
import {
  BASE_WORDS,
  difference,
  hours,
  percent,
  plain,
  seconds,
} from "./compare";

// One card: heading, number, one line of context, the change and an optional trend line.
// The "i" button explains it; clicking the number opens the sessions behind it.
export function Card({
  title,
  value,
  unit,
  note,
  change,
  hint,
  selected,
  onOpen,
  trend,
}) {
  // The number with its unit, used the same way whether or not it is a button.
  const shown = (
    <>
      {value}
      {unit && <span className="unit">{unit}</span>}
    </>
  );
  return (
    <article
      className={
        "panel compact-metric" +
        (selected ? " selected" : "") +
        (onOpen ? " clickable" : "")
      }
    >
      {/* The "i" sits after the heading, not beside it in the same row, so its explanation
          opens below the heading at the card's full width instead of squeezing the title.
          The button itself is drawn in the heading's top corner (see .compact-metric > .info). */}
      <div className="card-head">
        <h3>{title}</h3>
      </div>
      {hint && <Info topic={title}>{hint}</Info>}
      {/* Only a card with sessions behind it makes its number a button. */}
      {onOpen ? (
        <button
          type="button"
          className="metric-number"
          aria-pressed={selected}
          aria-label={`${title}: ${value}${unit ? " " + unit : ""}. Show these sessions`}
          onClick={() => onOpen(title)}
        >
          {shown}
        </button>
      ) : (
        <strong className="metric-number">{shown}</strong>
      )}
      {note && <small>{note}</small>}
      {change && (
        <small className={"change " + change.tone}>{change.text}</small>
      )}
      {trend}
    </article>
  );
}

// The answer in one sentence, before any card.
// The session count and never-connected share are buttons that open those sessions.
export function Headline({ summary, before, when, versus, onClear, onOpen }) {
  // No sessions: say so and offer a way out. Clear filters only shows when some are on.
  if (!summary.sessions)
    return (
      <p className="panel headline">
        <strong>{when}:</strong> no sessions match. Try another day or All data.{" "}
        {onClear && (
          <button type="button" className="link-button" onClick={onClear}>
            Clear filters
          </button>
        )}
      </p>
    );
  // The never-connected share now and on the dates compared with, when there are any.
  const never = summary.groups.no_success.share;
  const neverBefore = before?.groups.no_success.share;
  return (
    <p className="panel headline">
      <strong>{when}:</strong>{" "}
      <button
        type="button"
        className="link-button key-link"
        onClick={() => onOpen("all")}
      >
        {plural(summary.sessions, "session")}
      </button>
      .
      {never != null && (
        <>
          {" "}
          <button
            type="button"
            className="link-button key-link"
            onClick={() => onOpen("no_success")}
          >
            {percent(never)}
          </button>{" "}
          of those that tried never connected
          {neverBefore != null && ` (${percent(neverBefore)} ${versus})`}.
        </>
      )}
      {summary.ready_p50 != null && (
        <>
          {" "}
          Typical time to video:{" "}
          <span className="nowrap key">{seconds(summary.ready_p50)}</span>.
        </>
      )}
    </p>
  );
}

// What every card on the page is built from: the numbers on screen, the numbers compared
// with (or null), how many days they cover, the comparison in words, the open card and
// how to open one.
export function cardHelpers({ data, before, days, versus, category, onOpen }) {
  const summary = data.summary;
  const groups = summary.groups;

  // Props for a card whose number opens the sessions of one group.
  const opens = (key) => ({
    selected: category === key,
    onOpen: (from) => onOpen(key, from),
  });

  // Card props shared by every card that opens one group. For all of them, fewer is better.
  function group(key) {
    const { count, share, base, definition } = groups[key];
    const then = before?.groups[key];
    const of = BASE_WORDS[key] || "those who tried";
    return {
      value: number(count),
      note: share == null ? null : `${number(share, 1)}% of ${of}`,
      // The share is compared, not the count, so busier days don't look worse.
      // A gap within chance is no change, and under MIN_SESSIONS either side
      // it is not judged at all.
      change:
        then &&
        difference(
          share,
          then.share,
          percent,
          versus,
          false,
          share == null || then.share == null
            ? 0
            : shareNoise(share, base, then.share, then.base),
          base < MIN_SESSIONS || then.base < MIN_SESSIONS,
        ),
      hint: `${definition} The % is out of ${of}.`,
      ...opens(key),
    };
  }

  // The change line for one of the summary's own numbers, against the dates compared with.
  function changeOf(key, format, higherIsBetter, noise = 0) {
    return (
      before &&
      difference(
        summary[key],
        before[key],
        format,
        versus,
        higherIsBetter,
        noise,
      )
    );
  }
  // Everyday noise of a daily number, from its trend, for periods as long as this one.
  const noiseOf = (field) => dailyNoise(data.trend, field, days);

  // Faint days rest on few sessions: those who tried for the never-connected share,
  // every session for the rest.
  const trend = (field, format) => (
    <Sparkline
      trend={data.trend}
      field={field}
      format={format}
      counts={data.trend.map((day) =>
        field === "never_connected_share" ? day.tried : day.sessions,
      )}
    />
  );

  return { summary, groups, opens, group, changeOf, noiseOf, trend };
}

// The five headline cards, each with a trend line. Takes the same props as cardHelpers.
export function HeadlineCards(props) {
  const { before, days, onOpen } = props;
  const { summary, groups, opens, group, changeOf, noiseOf, trend } =
    cardHelpers(props);
  return (
    <div className="daily-metrics headline-row">
      <Card
        title="Sessions"
        value={number(summary.sessions)}
        note={
          <button
            type="button"
            className="link-button key-link"
            onClick={() => onOpen("tried", "Sessions")}
          >
            {number(summary.attempted)} tried to connect
          </button>
        }
        // More or fewer sessions is neither good nor bad, so null.
        change={changeOf(
          "sessions",
          plain,
          null,
          before ? countNoise(summary.sessions, before.sessions) : 0,
        )}
        hint={groups.all.definition}
        {...opens("all")}
        trend={trend("sessions", plain)}
      />
      <Card
        title="Never connected"
        {...group("no_success")}
        trend={trend("never_connected_share", percent)}
      />
      <Card
        title="Time to video"
        unit={summary.ready_p50 == null ? "" : "s"}
        value={number(summary.ready_p50, 1)}
        note={
          summary.ready_p90 == null
            ? null
            : `Typical wait · 1 in 10 waited over ${seconds(summary.ready_p90)}`
        }
        change={changeOf("ready_p50", seconds, false, noiseOf("ready_p50"))}
        hint={`How long players waited from connecting to the first video frame, on each session's first successful connect (timeToReadyMs). The big number is the typical wait: half the ${plural(groups.ready.count, "session")} that got video waited less. "1 in 10 waited over" is how long the slowest tenth waited. The small line shows one value per day for the last four weeks; hover over it to see each day.`}
        {...opens("ready")}
        trend={trend("ready_p50", seconds)}
      />
      <Card
        title="Streamed hours"
        value={number(summary.streamed_hours, 1)}
        unit="h"
        note={`${number(summary.connected - groups.connected_no_stats.count)} of ${number(summary.connected)} connected sessions sent readings`}
        // Streamed hours is a total over the days, not a daily figure,
        // so its noise grows with the number of days.
        change={changeOf(
          "streamed_hours",
          hours,
          true,
          noiseOf("streamed_hours") * days,
        )}
        hint={`Counted from the player app's per-second readings: each second a session sent stats counts once. ${number(groups.connected_no_stats.count)} connected sessions sent no stats, so their time isn't counted and the real total is higher.`}
        {...opens("measured")}
        trend={trend("streamed_hours", hours)}
      />
      <Card
        title="Time below 30 FPS"
        value={number(summary.low_fps_time_share, 1)}
        unit={summary.low_fps_time_share == null ? "" : "%"}
        note={`${hours(summary.low_fps_hours)} of ${hours(summary.streamed_hours)} streamed`}
        change={changeOf(
          "low_fps_time_share",
          percent,
          false,
          noiseOf("low_fps_time_share"),
        )}
        hint="The share of streamed time where some player's frame rate was under 30. An average FPS hides the bad stretches; this does not. 30 is the idle rate, so only below 30 counts."
        {...opens("any_low_fps")}
        trend={trend("low_fps_time_share", percent)}
      />
    </div>
  );
}

// The folded detail sections under the charts: connection, stream quality, and network and
// device cards, each section's heading giving its key numbers.
// Network and device numbers: [measure, title, unit, higher is better, what it is].
// Units are read from the value ranges; the player app does not document them.
// Each card shows the typical session (the middle one), because a few sessions with huge
// spikes pull the plain average far from what most players saw.
const NETWORK = [
  [
    "latency",
    "Latency (latency)",
    " ms",
    false,
    "Delay between player and host, as the app reports it.",
  ],
  [
    "jitter",
    "Jitter (jitter)",
    " ms",
    false,
    "How much the delay jumps around.",
  ],
  [
    "bitrate",
    "Bitrate (bitrate)",
    " Mbps",
    true,
    "Video data received each second.",
  ],
  [
    "downloadSpeed",
    "Download speed (downloadSpeed)",
    " Mbps",
    true,
    "The player's download speed.",
  ],
  [
    "decodeDuration",
    "Decode time (decodeDuration)",
    " ms",
    false,
    "Time the player takes to decode a frame.",
  ],
  [
    "encodeDuration",
    "Encode time (encodeDuration)",
    " ms",
    false,
    "Time the host takes to encode a frame.",
  ],
];

// Folded sections for detail; each heading gives the key numbers so most
// people never need to open it. Takes the same props as cardHelpers.
export function DetailSections(props) {
  const { before, versus } = props;
  const { summary, groups, opens, group, changeOf, noiseOf } =
    cardHelpers(props);
  return (
    <>
      <details className="section">
        <summary>
          Connection details
          <span className="summary-hint">
            {number(groups.failure.count)} had a connection error ·{" "}
            {number(groups.repeated_attempts.count)} needed more than one
            attempt · {number(groups.stream_drops.count)} lost video while
            playing
          </span>
        </summary>
        <div className="daily-metrics">
          <Card title="Had a connection error" {...group("failure")} />
          <Card title="More than one attempt" {...group("repeated_attempts")} />
          <Card title="Lost video while playing" {...group("stream_drops")} />
        </div>
      </details>

      <details className="section">
        <summary>
          Stream quality
          <span className="summary-hint">
            {number(groups.low_fps.count)} averaged below 30 FPS ·{" "}
            {summary.low_fps_time_share == null
              ? "—"
              : percent(summary.low_fps_time_share)}{" "}
            of streamed time below 30 FPS
          </span>
        </summary>
        <div className="daily-metrics">
          <Card title="Sessions averaging under 30 FPS" {...group("low_fps")} />
          <Card
            title="Average FPS"
            value={plain(summary.fps_mean)}
            change={changeOf("fps_mean", plain, true, noiseOf("fps_mean"))}
            hint="Every per-second FPS reading from every session, added up and divided by how many readings there are. 30 is the idle rate, so idle desktops pull this towards 30."
            {...opens("fps")}
          />
          <Card title="Many skipped frames" {...group("high_skip")} />
        </div>
      </details>

      <details className="section">
        <summary>
          Network and device
          <span className="summary-hint">
            {summary.measures.latency
              ? `Typical latency ${number(summary.measures.latency.typical, 0)} ms`
              : "No readings"}
            {summary.measures.downloadSpeed &&
              ` · typical download speed ${number(summary.measures.downloadSpeed.typical, 1)} Mbps`}
          </span>
        </summary>
        <div className="daily-metrics">
          {NETWORK.map(([key, title, unit, higherIsBetter, what]) => {
            const now = summary.measures[key];
            const then = before?.measures?.[key];
            // "1 in 10" is the bad tail: the lowest tenth for higher-is-better
            // numbers, the highest tenth for the rest.
            const side = higherIsBetter ? "below" : "above";
            return (
              <Card
                key={key}
                title={title}
                value={now ? number(now.typical, 1) : "—"}
                unit={now ? unit.trim() : ""}
                note={
                  now &&
                  `Typical session · 1 in 10 ${side} ${number(higherIsBetter ? now.low_tenth : now.high_tenth, 1)}${unit}`
                }
                // No daily history for these yet, so a fixed share of the old
                // value stands in for noise.
                change={
                  now &&
                  then &&
                  difference(
                    now.typical,
                    then.typical,
                    (value) => number(value, 1) + unit,
                    versus,
                    higherIsBetter,
                    Math.abs(then.typical) * RELATIVE_NOISE,
                  )
                }
                hint={`${what} The big number is the typical session: each session's own average, then the middle one of the ${now ? plural(now.sessions, "session") : "sessions"} that sent it. 1 in 10 sessions were ${side} the second number. The plain average of all ${now ? number(now.readings) : "—"} per-second readings is ${now ? number(now.average, 1) + unit : "—"}; a few sessions with big spikes pull it away from the typical session. Units are inferred from the values (ms, Mbps); the app does not document them.`}
              />
            );
          })}
        </div>
      </details>
    </>
  );
}
