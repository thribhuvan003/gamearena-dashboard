import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { getReport } from "./api";
import { DailyImpact } from "./impact";
import { Notice, dateLabel, utcTime } from "./format";
import { readUrl, writeUrl } from "./url";
import { CopyLinkButton } from "./share";
import "./style.css";

// Open on the latest complete day: a day that is still filling in makes every number look low.
function latestDay(range) {
  const complete =
    new Date(range.last_seen) >= new Date(`${range.end}T23:00:00Z`);
  if (complete || range.start === range.end) return range.end;
  const day = new Date(`${range.end}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() - 1);
  return day.toISOString().slice(0, 10);
}

// One line on how fresh everything is: where the data ends, and when the numbers were made.
function Freshness({ range }) {
  if (!range?.end) return null;
  const processed = range.processed;
  if (!processed?.finished_at)
    return (
      <p className="notice">
        The numbers are still being prepared. They update every few minutes;
        refresh shortly.
      </p>
    );
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

// A date some days before or after another, as YYYY-MM-DD.
function shift(day, days) {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

function App() {
  const [range, setRange] = useState(null);
  const [period, setPeriod] = useState(null);
  const [preset, setPreset] = useState("day");
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const written = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    getReport("range", {}, controller.signal)
      .then((data) => {
        setRange(data);
        // A link with dates opens on those dates; otherwise the latest complete day.
        const url = readUrl();
        if (
          DAY.test(url.start || "") &&
          DAY.test(url.end || "") &&
          url.start <= url.end
        ) {
          setPreset("custom");
          setPeriod({ start: url.start, end: url.end });
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
  useEffect(() => {
    if (!period) return;
    writeUrl({ start: period.start, end: period.end }, !written.current);
    written.current = true;
  }, [period]);
  useEffect(() => {
    function follow() {
      const url = readUrl();
      if (DAY.test(url.start || "") && DAY.test(url.end || ""))
        setPeriod((current) =>
          current?.start === url.start && current?.end === url.end
            ? current
            : { start: url.start, end: url.end },
        );
    }
    window.addEventListener("popstate", follow);
    return () => window.removeEventListener("popstate", follow);
  }, []);

  function choose(next, selected) {
    setError("");
    setPreset(selected);
    setPeriod({ start: next.start, end: next.end });
  }

  function apply(event) {
    event.preventDefault();
    const dates = Object.fromEntries(new FormData(event.currentTarget));
    if (dates.start > dates.end) {
      setError("Start date is after end date.");
      return;
    }
    choose(dates, "custom");
  }

  async function refresh() {
    setLoading(true);
    setError("");
    try {
      const next = await getReport("range");
      setRange(next);
      if (!next.end) setPeriod(null);
      else if (preset === "day") {
        const day = latestDay(next);
        setPeriod({ start: day, end: day });
      } else if (preset === "all")
        setPeriod({ start: next.start, end: next.end });
      else if (preset === "recent")
        setPeriod({ start: shift(latestDay(next), -29), end: latestDay(next) });
      else if (preset === "week")
        setPeriod({ start: shift(latestDay(next), -6), end: latestDay(next) });
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
          <button disabled={loading} onClick={refresh}>
            Refresh data
          </button>
        </div>
      </header>
      <section className="period-panel" aria-label="Report period">
        <div className="date-bar">
          <div className="segmented" role="group" aria-label="Dates">
            {range?.end &&
              [
                [
                  "day",
                  "Latest day",
                  () => ({ start: latestDay(range), end: latestDay(range) }),
                ],
                [
                  "week",
                  "Last 7 days",
                  () => ({
                    start: shift(latestDay(range), -6),
                    end: latestDay(range),
                  }),
                ],
                [
                  "recent",
                  "Last 30 days",
                  () => ({
                    start: shift(latestDay(range), -29),
                    end: latestDay(range),
                  }),
                ],
                [
                  "all",
                  "All data",
                  () => ({ start: range.start, end: range.end }),
                ],
              ].map(([key, label, dates]) => (
                <button
                  key={key}
                  aria-pressed={
                    Boolean(period) &&
                    dates().start === period.start &&
                    dates().end === period.end
                  }
                  disabled={loading}
                  onClick={() => choose(dates(), key)}
                >
                  {label}
                </button>
              ))}
          </div>
          <label className="day-selector">
            Pick a day
            <input
              type="date"
              disabled={loading}
              value={period?.end || ""}
              onChange={(event) => {
                if (event.target.value)
                  choose(
                    { start: event.target.value, end: event.target.value },
                    "custom",
                  );
              }}
            />
          </label>
        </div>
        {period && period.start !== period.end && (
          <p>
            {dateLabel(period.start)} – {dateLabel(period.end)}
          </p>
        )}
        <details className="custom-dates">
          <summary>Pick a range</summary>
          <form
            className="date-form"
            key={period?.start + "-" + period?.end}
            onSubmit={apply}
          >
            <label>
              From
              <input
                name="start"
                type="date"
                required
                defaultValue={period?.start || ""}
              />
            </label>
            <label>
              To
              <input
                name="end"
                type="date"
                required
                defaultValue={period?.end || ""}
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
        {range && !range.end && (
          <p>No telemetry stored yet. Import the data, then refresh.</p>
        )}
      </section>
      {period && <DailyImpact period={period} revision={revision} />}
    </main>
  );
}

createRoot(document.getElementById("root")).render(<App />);
