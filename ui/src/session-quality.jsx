// Stream quality in the session pop-up: the one-line verdict under the summary and the Stream
// quality tab. Only facts measured in this session; the full tables need technical details.
import React from "react";
import { Info, Notice, number, utcTime } from "./format";
import { DataTable, Tile } from "./session-table";
import { MEASUREMENTS, PERFORMANCE_NOTES, heading } from "./session-words";

// Stream quality in one sentence: only facts measured in this session.
export function verdict(metrics, batches) {
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
// Each entry: measurement, tile label, unit after the average, and the line under it.
const QUALITY_TILES = [
  [
    "fps",
    "Frames per second",
    "",
    // No valid readings means no share to give, rather than "NaN%".
    (m) =>
      m.valid
        ? `${number((m.under_30 / m.valid) * 100, 1)}% of the time under 30`
        : null,
  ],
  [
    "latency",
    "Latency (latency)",
    "\u00a0ms",
    (m) => `Worst second: ${number(m.maximum, 0)}\u00a0ms`,
  ],
  [
    "downloadSpeed",
    "Download speed (downloadSpeed)",
    "\u00a0Mbps",
    (m) => `Lowest: ${number(m.minimum, 1)}\u00a0Mbps`,
  ],
  [
    "bitrate",
    "Bitrate (bitrate)",
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

// Stream quality: tiles for everyone, the full tables with technical details, and a
// plain sentence when the app sent no readings at all. `list` is the loaded page of
// 10-second groups.
export function StreamQuality({ batches, metrics, technical, list }) {
  return batches ? (
    <>
      <div className="metric-grid">
        {QUALITY_TILES.map(([name, label, unit, describe]) => {
          const m = metrics.find((m) => m.metric === name);
          // A measurement the app never sent gets no tile, rather than one full of dashes.
          if (!m) return null;
          return (
            <Tile
              key={name}
              label={label}
              value={number(m.mean, 1) + unit}
              sub={describe(m)}
              info={MEASUREMENTS[name][2]}
            />
          );
        })}
      </div>
      {technical && (
        <>
          <p>
            The player app records one reading per second for each measurement
            and sends them in groups of 10. Each reading is that second&apos;s
            own value, not a running total.
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
            rows={metrics.map((m) => [
              heading(m.metric),
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
              Each row is one group of 10 readings; each number is the average
              of that group.
            </Info>
          </h3>
          <Notice {...list} />
          {list.data && (
            <DataTable
              label="Session stats batches"
              columns={[
                "Start",
                "End",
                ...Object.keys(MEASUREMENTS).map(heading),
              ]}
              rows={list.data.items.map((b) => [
                utcTime(b.bucket_start, true),
                utcTime(b.bucket_end, true),
                // Every measurement gets a column in the same order; one missing from a group shows a dash.
                ...Object.keys(MEASUREMENTS).map((name) =>
                  b.metrics?.[name] ? number(b.metrics[name].mean, 1) : "—",
                ),
              ])}
            />
          )}
        </>
      )}
    </>
  ) : (
    <p>
      The player app sent no stream readings for this session, so there is
      nothing to show here.
    </p>
  );
}
