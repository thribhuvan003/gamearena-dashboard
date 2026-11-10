// The page shell: title, Copy link and Refresh, the date picker and the "data up to" line.
// It renders the main page for the chosen dates.
import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { getReport } from "./api";
import { DailyImpact } from "./impact";
import { Notice, dateLabel, utcTime } from "./format";
import { readUrl, writeUrl } from "./url";
import { CopyLinkButton } from "./share";
import "./style.css";

// A date some days before or after another, as YYYY-MM-DD.
function shift(day, days) {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

// Open on the latest complete day: a day that is still filling in makes every number look low.
function latestDay(range) {
  // The last day counts as complete once data has arrived from its final hour.
  // When it is the only day stored, it is shown anyway rather than nothing.
  const complete =
    new Date(range.last_seen) >= new Date(`${range.end}T23:00:00Z`);
  if (complete || range.start === range.end) return range.end;
  return shift(range.end, -1);
}

// The quick date buttons: [key, label, their dates in the stored range].
const PRESETS = [
  [
    "day",
    "Latest day",
    (range) => ({ start: latestDay(range), end: latestDay(range) }),
  ],
  [
    "week",
    "Last 7 days",
    (range) => ({ start: shift(latestDay(range), -6), end: latestDay(range) }),
  ],
  [
    "recent",
    "Last 30 days",
    (range) => ({ start: shift(latestDay(range), -29), end: latestDay(range) }),
  ],
  ["all", "All data", (range) => ({ start: range.start, end: range.end })],
];

// The dates in a link, or null when it has none or they make no sense.
function datesIn(url) {
  // A hand-edited or old link must not break the page, so anything odd is ignored.
  const day = /^\d{4}-\d{2}-\d{2}$/;
  // A real date reads back the same; 2026-02-30 would come back as 2026-03-02.
  const real = (value) =>
    day.test(value || "") &&
    new Date(value + "T00:00:00Z").toISOString().slice(0, 10) === value;
  if (!real(url.start) || !real(url.end) || url.start > url.end) return null;
  return { start: url.start, end: url.end };
}

// One line on how fresh everything is: where the data ends, and when the numbers were made.
function Freshness({ range }) {
  if (!range?.end) return null;
  const processed = range.processed;
  // Data is stored but the numbers have never been worked out yet.
  if (!processed?.finished_at)
    return (
      <p className="notice">
        The numbers are still being prepared. They update every few minutes;
        refresh shortly.
      </p>
    );
  // "behind" means data arrived after the last update, so the numbers miss some of it;
  // the line then stands out as a notice and says so.
  return (
    <p className={processed.behind ? "notice" : undefined}>
      {range.last_seen && (
        <span className="nowrap">Data up to {utcTime(range.last_seen)} · </span>
      )}
      <span className="nowrap">
        numbers updated {utcTime(processed.finished_at)} (UTC)
      </span>
      {processed.behind &&
        ". Newer data has arrived; it appears after the next update."}
    </p>
  );
}

// The whole page. It owns the dates; everything below the date picker is DailyImpact.
function App() {
  // Which days have data, and how fresh the numbers are, as the API reports it.
  const [range, setRange] = useState(null);
  // The dates being shown: { start, end }, or null before they are known.
  const [period, setPeriod] = useState(null);
  // Which quick date button picked them, or "custom" for dates chosen by hand.
  const [preset, setPreset] = useState("day");
  // Goes up on every Refresh, which makes every report on the page load again.
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  // The "Pick a range" boxes, kept in step with the dates shown.
  const [custom, setCustom] = useState({ start: "", end: "" });
  // Whether the dates have been put in the address bar yet this visit.
  const written = useRef(false);

  // On opening, ask which dates have data, then decide which dates to show.
  useEffect(() => {
    const controller = new AbortController();
    getReport("range", {}, controller.signal)
      .then((data) => {
        setRange(data);
        // A link with dates opens on those dates; otherwise the latest complete day.
        const dates = datesIn(readUrl());
        if (dates) {
          setPreset("custom");
          setPeriod(dates);
        } else if (data.end) {
          const day = latestDay(data);
          setPeriod({ start: day, end: day });
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError(error.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, []);

  // The dates live in the address bar too, so Back returns to the previous dates.
  // The first write replaces the entry, so opening the page adds no extra Back step.
  useEffect(() => {
    if (!period) return;
    writeUrl({ start: period.start, end: period.end }, !written.current);
    written.current = true;
    setCustom(period);
  }, [period]);
  // Back or Forward to other dates shows exactly those dates, so Refresh keeps them too.
  useEffect(() => {
    function follow() {
      const dates = datesIn(readUrl());
      // A step that only changed something else, like a filter, leaves the dates alone.
      if (
        !dates ||
        (dates.start === period?.start && dates.end === period?.end)
      )
        return;
      setPreset("custom");
      setPeriod(dates);
    }
    window.addEventListener("popstate", follow);
    return () => window.removeEventListener("popstate", follow);
  }, [period]);

  // Shows new dates, remembering which button (or "custom") chose them.
  function choose(next, selected) {
    setError("");
    setPreset(selected);
    setPeriod({ start: next.start, end: next.end });
  }

  // The "Show these dates" form. Dates the wrong way round get a message, not a request.
  function apply(event) {
    event.preventDefault();
    if (custom.start > custom.end) {
      setError("Start date is after end date.");
      return;
    }
    choose(custom, "custom");
  }

  // Refresh data: asks again which dates exist, then reloads every number on the page.
  async function refresh() {
    setLoading(true);
    setError("");
    try {
      const next = await getReport("range");
      setRange(next);
      // A quick date button moves with the data; picked dates stay put.
      const dates = PRESETS.find(([key]) => key === preset)?.[2];
      // No data is stored any more, so there are no dates to show.
      if (!next.end) setPeriod(null);
      else if (dates) {
        const moved = dates(next);
        setPeriod((current) =>
          current?.start === moved.start && current?.end === moved.end
            ? current
            : moved,
        );
      }
      setRevision((value) => value + 1);
    } catch (error) {
      setError(error.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="dashboard">
      <header className="page-header">
        <h1>GameArena insights</h1>
        {/* Refresh re-reads the database for the whole page, so it sits with the page title.
            The link holds the dates, filters and open list, so it shares this exact view. */}
        <div className="header-actions">
          <CopyLinkButton />
          <button type="button" disabled={loading} onClick={refresh}>
            Refresh data
          </button>
        </div>
      </header>
      <section className="period-panel" aria-label="Report period">
        <div className="date-bar">
          <div className="segmented" role="group" aria-label="Dates">
            {/* A button is lit when its dates match the ones shown, however they were picked. */}
            {range?.end &&
              PRESETS.map(([key, label, datesOf]) => {
                const dates = datesOf(range);
                return (
                  <button
                    type="button"
                    key={key}
                    aria-pressed={
                      Boolean(period) &&
                      dates.start === period.start &&
                      dates.end === period.end
                    }
                    disabled={loading}
                    onClick={() => choose(dates, key)}
                  >
                    {label}
                  </button>
                );
              })}
          </div>
          {/* Blank while a range is shown, so it never looks like only one day is. */}
          <label className="day-selector">
            Pick a day
            <input
              type="date"
              disabled={loading}
              value={period && period.start === period.end ? period.end : ""}
              onChange={(event) => {
                // Clearing the box is ignored; only a real day changes the dates.
                if (event.target.value)
                  choose(
                    { start: event.target.value, end: event.target.value },
                    "custom",
                  );
              }}
            />
          </label>
        </div>
        {/* For a range, the dates are spelled out, since the day box above is blank. */}
        {period && period.start !== period.end && (
          <p>
            {dateLabel(period.start)} – {dateLabel(period.end)}
          </p>
        )}
        <details className="custom-dates">
          <summary>Pick a range</summary>
          <form className="date-form" onSubmit={apply}>
            <label>
              From
              <input
                type="date"
                required
                value={custom.start}
                onChange={(event) =>
                  setCustom({ ...custom, start: event.target.value })
                }
              />
            </label>
            <label>
              To
              <input
                type="date"
                required
                value={custom.end}
                onChange={(event) =>
                  setCustom({ ...custom, end: event.target.value })
                }
              />
            </label>
            <button type="submit" disabled={loading}>
              Show these dates
            </button>
          </form>
        </details>
        <Freshness range={range} />
        <Notice error={error} loading={loading}>
          Loading dates…
        </Notice>
        {/* The API answered, but the database holds no sessions yet. */}
        {range && !range.end && (
          <p>No telemetry stored yet. Import the data, then refresh.</p>
        )}
      </section>
      {/* The rest of the page waits until there are dates to show. */}
      {period && (
        <DailyImpact
          period={period}
          revision={revision}
          dataStart={range?.start?.slice(0, 10)}
        />
      )}
    </main>
  );
}

createRoot(document.getElementById("root")).render(<App />);
