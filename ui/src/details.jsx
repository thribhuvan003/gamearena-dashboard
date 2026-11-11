// The folded detail sections under the charts: connection, stream quality, and network and
// device cards, each section's heading giving its key numbers.
import React from "react";
import { number, plural } from "./format";
import { RELATIVE_NOISE } from "./noise";
import { difference, percent, plain } from "./compare";
import { Card, cardHelpers } from "./cards";

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
