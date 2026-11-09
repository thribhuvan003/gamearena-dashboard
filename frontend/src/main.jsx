import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { getReport } from "./api";
import { DailyImpact } from "./impact";
import { Notice, dateLabel, utcTime } from "./format";
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

// The cards show what the processor last saved, so say how fresh that is.
function Processed({ range }) {
  if (!range?.end) return null;
  const processed = range.processed;
  if (!processed?.finished_at)
    return (
      <p className="notice">
        The numbers haven't been prepared yet. Run process.cmd, then refresh.
      </p>
    );
  return (
    <p className={processed.behind ? "notice" : undefined}>
      Numbers last updated {utcTime(processed.finished_at)} UTC.
      {processed.behind &&
        " New data has arrived since; the next update includes it."}
    </p>
  );
}

function App() {
  const [range, setRange] = useState(null);
  const [period, setPeriod] = useState(null);
  const [preset, setPreset] = useState("day");
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    getReport("range", {}, controller.signal)
      .then((data) => {
        setRange(data);
        if (data.end) {
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
        setPeriod({ start: next.recent_start, end: next.end });
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
        {/* Refresh re-reads the database for the whole page, so it sits with the page title. */}
        <div className="header-actions">
          <span className="local-badge">Local data · times in UTC</span>
          <button disabled={loading} onClick={refresh}>
            Refresh data
          </button>
        </div>
      </header>
      <section className="period-panel" aria-label="Report period">
        <div className="preset-buttons">
          <label className="day-selector">
            Day (UTC)
            <input
              aria-label="Selected day"
              type="date"
              disabled={loading}
              value={period?.end || ""}
              onChange={(event) => {
                if (event.target.value)
                  choose(
                    { start: event.target.value, end: event.target.value },
                    "day",
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
        {period?.end === range?.end && range?.last_seen && (
          <p>
            Data until{" "}
            {new Date(range.last_seen).toLocaleTimeString("en-GB", {
              timeZone: "UTC",
              hour: "2-digit",
              minute: "2-digit",
            })}{" "}
            UTC on {dateLabel(range.end)}.
          </p>
        )}
        <details className="custom-dates">
          <summary>Choose a date range</summary>
          <div className="preset-buttons">
            <button
              disabled={!range?.start || loading}
              onClick={() => choose(range, "all")}
            >
              All data
            </button>
            <button
              disabled={!range?.recent_start || loading}
              onClick={() =>
                choose({ start: range.recent_start, end: range.end }, "recent")
              }
            >
              Latest 30 stored days
            </button>
          </div>
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
              Apply dates
            </button>
          </form>
        </details>
        <Processed range={range} />
        <Notice error={error} loading={loading}>
          Reading available dates…
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
