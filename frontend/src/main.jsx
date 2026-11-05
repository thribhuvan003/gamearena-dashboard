import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Findings } from "./findings";
import {
  DataGuide,
  Investigation,
  MonthlyComparison,
  Notice,
  Performance,
  SessionOverview,
  dateLabel,
} from "./sections";
import "./style.css";

const reports = ["summary", "coverage", "performance", "investigation"];

// The browser asks for named reports. It never receives a database connection or sends SQL.
async function getReport(name, params = {}, signal) {
  let response;
  try {
    response = await fetch(`/api/${name}/?${new URLSearchParams(params)}`, {
      signal,
    });
  } catch (error) {
    if (error.name === "AbortError") throw error;
    throw new Error(
      "Cannot reach the local server. Keep the VS Code CMD terminal running, then retry.",
    );
  }
  let result;
  try {
    result = await response.json();
  } catch (error) {
    if (error.name === "AbortError") throw error;
    throw new Error(
      "The server did not return a readable report. Restart the dashboard and retry.",
    );
  }
  if (!response.ok)
    throw new Error(
      result.error ||
        "This report could not be loaded. Select Refresh data to retry.",
    );
  return result;
}

// Quote CSV cells and keep producer field names from becoming spreadsheet formulas.
function csvCell(value) {
  const text =
    typeof value === "string" && /^[=+\-@\t\r]/.test(value)
      ? `'${value}`
      : String(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}

function App() {
  const [range, setRange] = useState(null);
  const [period, setPeriod] = useState(null);
  const [preset, setPreset] = useState("all");
  const [revision, setRevision] = useState(0);
  const [data, setData] = useState({});
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState({ range: true });
  const dateForm = useRef(null);
  const lastRefresh = useRef(0);

  // Discover the stored period instead of hard-coding the dates from this backup.
  useEffect(() => {
    const controller = new AbortController();
    getReport("range", {}, controller.signal)
      .then((result) => {
        setRange(result);
        if (result.start && result.end)
          setPeriod({ start: result.start, end: result.end });
      })
      .catch((error) => {
        if (error.name !== "AbortError") setErrors({ range: error.message });
      })
      .finally(() => {
        if (!controller.signal.aborted)
          setLoading((previous) => ({ ...previous, range: false }));
      });
    return () => controller.abort();
  }, []);

  // Load panels independently. Cancel old requests when the user chooses different dates.
  useEffect(() => {
    if (!period) return;
    const controller = new AbortController();
    const fresh = revision !== lastRefresh.current;
    lastRefresh.current = revision;
    setData({});
    setErrors({});
    setLoading(Object.fromEntries(reports.map((name) => [name, true])));
    for (const name of reports) {
      getReport(
        name,
        { ...period, refresh: fresh ? "1" : "0" },
        controller.signal,
      )
        .then((result) => {
          if (!controller.signal.aborted)
            setData((previous) => ({ ...previous, [name]: result }));
        })
        .catch((error) => {
          if (!controller.signal.aborted && error.name !== "AbortError") {
            setErrors((previous) => ({ ...previous, [name]: error.message }));
          }
        })
        .finally(() => {
          if (!controller.signal.aborted)
            setLoading((previous) => ({ ...previous, [name]: false }));
        });
    }
    return () => controller.abort();
  }, [period, revision]);

  const busy = Object.values(loading).some(Boolean);
  const complete = reports.every((name) => Boolean(data[name]));
  const periodText = period
    ? `${dateLabel(period.start)} to ${dateLabel(period.end)}`
    : "Available data";

  // Reset unfinished edits too, including when a preset selects the already-applied dates.
  function choosePeriod(next, selectedPreset = "custom") {
    dateForm.current?.reset();
    setPreset(selectedPreset);
    setPeriod({ start: next.start, end: next.end });
  }

  function applyPeriod(event) {
    event.preventDefault();
    const dates = Object.fromEntries(new FormData(event.currentTarget));
    if (dates.start > dates.end) {
      setErrors((previous) => ({
        ...previous,
        range: "Choose a start date on or before the end date.",
      }));
      return;
    }
    choosePeriod(dates);
  }

  // Python supplies the 30-day boundary, so all date rules stay in the logic folder.
  function recentPeriod() {
    choosePeriod({ start: range.recent_start, end: range.end }, "recent");
  }

  // Refresh follows the selected preset after an import; a custom date range is preserved.
  async function refresh() {
    setLoading((previous) => ({ ...previous, range: true }));
    try {
      const next = await getReport("range");
      setRange(next);
      // A successful connection clears an earlier range error, including for an empty database.
      setErrors((previous) => {
        const remaining = { ...previous };
        delete remaining.range;
        return remaining;
      });
      if (next.start && next.end) {
        if (preset === "recent")
          choosePeriod({ start: next.recent_start, end: next.end }, "recent");
        else if (preset === "all" || !period) choosePeriod(next, "all");
      } else {
        setPeriod(null);
        setData({});
        setErrors({});
        setPreset("all");
        setLoading({ range: false });
      }
      setRevision((value) => value + 1);
    } catch (error) {
      setErrors((previous) => ({ ...previous, range: error.message }));
    } finally {
      setLoading((previous) => ({ ...previous, range: false }));
    }
  }

  // Download displayed aggregates only; raw events, IDs and diagnostic text stay private.
  function exportReport() {
    const counts = data.summary.counts;
    const rows = [
      ["Selected dates (UTC)", period.start, period.end],
      ["Session metric", "Value"],
    ];
    Object.entries(counts)
      .filter(([, value]) => typeof value === "number")
      .forEach(([name, value]) => rows.push([name, value]));
    rows.push([], ["Session outcome", "Sessions"]);
    counts.groups.forEach((group) => rows.push([group.name, group.count]));
    rows.push([], ["Statistics coverage", "Count"]);
    Object.entries(data.coverage).forEach(([name, value]) =>
      rows.push([name, value]),
    );
    rows.push(
      [],
      ["Day (UTC)", "Observed sessions", "With success", "With failure"],
    );
    data.summary.trend.forEach((row) =>
      rows.push([row.day, row.sessions, row.succeeded, row.failed]),
    );
    rows.push([], ["Failure phase", "Stage", "Events", "Sessions"]);
    data.summary.failures.forEach((row) =>
      rows.push([row.phase, row.stage, row.events, row.sessions]),
    );
    rows.push([], ["Measurement field", "Present batches", "Array batches"]);
    data.performance.inventory.forEach((row) =>
      rows.push([row.metric, row.present_rows, row.array_rows]),
    );
    rows.push(
      [],
      [
        "Metric",
        "Unit",
        "Numeric samples",
        "Null entries",
        "Invalid entries",
        "Average",
        "Minimum",
        "Maximum",
      ],
    );
    data.performance.metrics.forEach((row) =>
      rows.push([
        row.metric,
        row.metric === "fps" ? "FPS" : "Recorded units (unconfirmed)",
        row.valid,
        row.missing,
        row.invalid,
        row.mean,
        row.minimum,
        row.maximum,
      ]),
    );
    rows.push([], ["Month", "Metric", "Numeric samples", "Average"]);
    data.performance.monthly.forEach((month) =>
      month.metrics.forEach((metric) =>
        rows.push([month.month, metric.metric, metric.valid, metric.mean]),
      ),
    );
    rows.push([], ["Investigation measure", "Value"]);
    Object.entries(data.investigation.counts).forEach(([name, value]) =>
      rows.push([name, value]),
    );
    rows.push([], ["Readiness field: timeToReadyMs", "Value"]);
    Object.entries(data.investigation.readiness).forEach(([name, value]) =>
      rows.push([name, value]),
    );
    rows.push([], ["Payload field", "Occurrences", "Sessions"]);
    data.investigation.payload.forEach((row) =>
      rows.push([row.field, row.occurrences, row.sessions]),
    );
    rows.push(
      [],
      [
        "Notes",
        "Sessions are not unique users. Event flags overlap. Statistics use batch start. Null and invalid samples are excluded. Producer units and timing definitions require confirmation.",
      ],
    );
    const csv = rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
    const url = URL.createObjectURL(
      new Blob([csv], { type: "text/csv;charset=utf-8;" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `gamearena-${period.start}-to-${period.end}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  // Display sections contain no counting rules. SQL and Python own those calculations.
  return (
    <main className="dashboard">
      <header className="page-header">
        <div>
          <p className="eyebrow">GameArena · Product analytics</p>
          <h1>Understand your sessions</h1>
          <p>
            Connections, measurements and important evidence — explained in
            plain language.
          </p>
        </div>
        <span className="local-badge">Local, read-only data</span>
      </header>
      <nav className="page-nav" aria-label="Dashboard sections">
        <a href="#findings">Product findings</a>
        <a href="#overview">Sessions</a>
        <a href="#performance">Performance</a>
        <a href="#data-guide">Data guide</a>
      </nav>
      <section id="period" className="period-panel" aria-label="Report period">
        <h2>Selected period</h2>
        <p className="selected-period">{periodText}</p>
        <p>Both dates are included. All report dates use UTC.</p>
        <div className="preset-buttons">
          <button
            aria-pressed={preset === "all"}
            disabled={loading.range || !range?.start}
            onClick={() => choosePeriod(range, "all")}
          >
            All data
          </button>
          <button
            aria-pressed={preset === "recent"}
            disabled={loading.range || !range?.recent_start}
            onClick={recentPeriod}
          >
            Latest 30 days
          </button>
          <button disabled={busy} onClick={refresh}>
            Refresh data
          </button>
        </div>
        {preset === "recent" && range?.end && (
          <p className="caption">
            Latest 30 days ends on the last stored date:{" "}
            <strong>{dateLabel(range.end)}</strong>. It does not use today's
            date.
          </p>
        )}
        {/* Keep presets quick to use; open custom fields only when they are needed. */}
        <details className="custom-dates">
          <summary>Choose custom dates</summary>
          <form
            ref={dateForm}
            key={`${period?.start}-${period?.end}`}
            onSubmit={applyPeriod}
            className="date-form"
          >
            <label>
              From
              <input
                aria-label="Start date"
                name="start"
                disabled={loading.range}
                type="date"
                required
                defaultValue={period?.start || ""}
              />
            </label>
            <label>
              To
              <input
                aria-label="End date"
                name="end"
                disabled={loading.range}
                type="date"
                required
                defaultValue={period?.end || ""}
              />
            </label>
            <button
              className="primary"
              disabled={loading.range || !range?.start}
              type="submit"
            >
              Apply dates
            </button>
          </form>
        </details>
        <Notice error={errors.range} loading={loading.range}>
          Reading the available dates…
        </Notice>
        {period && (
          <p className="report-status" role="status">
            {busy
              ? "Updating the selected period. Sections fill in as they finish."
              : Object.keys(errors).length
                ? "Some sections need attention. Check the message and select Refresh data to retry."
                : "Report ready for the selected period."}
          </p>
        )}
        {range && !range.start && (
          <p className="notice">
            No telemetry is stored yet. Import compatible data, then select
            Refresh data.
          </p>
        )}
      </section>
      {period && (
        <Findings
          summary={data.summary}
          investigation={data.investigation}
          performance={data.performance}
          error={errors.summary || errors.investigation || errors.performance}
        />
      )}
      <SessionOverview
        key={`sessions-${period?.start}-${period?.end}`}
        report={data.summary}
        coverage={data.coverage}
        error={errors.summary || errors.coverage}
        loading={loading.summary || loading.coverage}
        exportReport={exportReport}
        canExport={complete && !busy}
      />
      {!complete && period && (
        <p className="caption">
          The complete CSV becomes available after all sections have loaded.
        </p>
      )}
      <Investigation
        report={data.investigation}
        error={errors.investigation}
        loading={loading.investigation}
      />
      <Performance
        report={data.performance}
        error={errors.performance}
        loading={loading.performance}
      />
      <MonthlyComparison report={data.performance} />
      <DataGuide />
      <footer>
        <p>
          <a href="#period">Back to date selection</a>
        </p>
        GameArena · Aggregate reports only. Summaries are cached; select Refresh
        data after importing records.
      </footer>
    </main>
  );
}

createRoot(document.getElementById("root")).render(<App />);
