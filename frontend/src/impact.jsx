import React, { useEffect, useRef, useState } from "react";
import { useReport } from "./api";
import { AffectedSessions } from "./affected";
import { EVENTS } from "./sessions";
import { Info, Notice, dateLabel, number } from "./format";
import { readUrl, writeUrl } from "./url";
import { Sparkline } from "./sparkline";

// Asked for in review, but the data cannot answer them yet.
const PENDING = [
  "Many skipped frames uses a proposed rule (10+ per second, for 10% of the time). The team should confirm it.",
  "Device and browser: not in this data. The team needs to share the table that has them.",
  "Idle or in game: no marker, so 30 FPS on a desktop and in a game look the same.",
];

// Network and device numbers: [measure, title, unit, higher is better, what it is].
// Units are read from the value ranges; the player app does not document them.
// Each card shows the typical session (the middle one), because a few sessions with huge
// spikes pull the plain average far from what most players saw.
const NETWORK = [
  [
    "latency",
    "Delay",
    " ms",
    false,
    "Delay between player and host, as the app reports it.",
  ],
  [
    "jitter",
    "Delay variation",
    " ms",
    false,
    "How much the delay jumps around.",
  ],
  [
    "bitrate",
    "Video data rate",
    " Mbps",
    true,
    "Video data received each second.",
  ],
  [
    "downloadSpeed",
    "Download speed",
    " Mbps",
    true,
    "The player's download speed.",
  ],
  [
    "decodeDuration",
    "Time to show a frame",
    " ms",
    false,
    "Time the player takes to decode a frame.",
  ],
  [
    "encodeDuration",
    "Time to prepare a frame",
    " ms",
    false,
    "Time the host takes to encode a frame.",
  ],
];

const BREAKDOWNS = [
  "later_success",
  "no_later_success",
  "failure_after_end",
  "any_low_fps",
  "missing_stats",
  "connected_no_stats",
  "stats_only",
];

// Filter sections show their biggest few until "Show all" is clicked.
const SHOWN = 5;

// Reasons that mean the session worked, so they are never "the most common problem".
const NOT_A_PROBLEM = new Set([
  "Connected",
  "Connected after an error",
  "Never tried to connect",
]);

const percent = (value) => number(value, 1) + "%";
const seconds = (value) => number(value, 1) + " s";
const hours = (value) => number(value, 1) + " h";
const plain = (value) => number(value, 1);

// Plain words with the old value and whether that is good news,
// e.g. "▲ up from 9.6 s the day before · worse". Session counts have no good direction.
function difference(
  now,
  before,
  format,
  versus,
  higherIsBetter,
  noise = 0,
  tooFew = false,
) {
  if (now == null || before == null) return null;
  if (tooFew)
    return { text: `Too few sessions to compare with ${versus}`, tone: "" };
  // Inside the normal day-to-day range, a change is not a change.
  if (format(now) === format(before) || Math.abs(now - before) <= noise)
    return { text: `About the same as ${versus}`, tone: "" };
  const up = now > before;
  const tone =
    higherIsBetter == null ? "" : up === higherIsBetter ? "better" : "worse";
  const word = tone
    ? tone[0].toUpperCase() + tone.slice(1)
    : up
      ? "Up"
      : "Down";
  return {
    text: `${up ? "▲" : "▼"} ${word} · was ${format(before)} ${versus}`,
    tone,
  };
}

// How far apart two shares must be before the gap is more than chance, at 99% confidence
// (a two-proportion test). Shares are in percent; n is how many sessions each is out of.
function shareNoise(p1, n1, p2, n2) {
  const p = (p1 * n1 + p2 * n2) / 100 / (n1 + n2);
  return 2.58 * Math.sqrt(p * (1 - p) * (1 / n1 + 1 / n2)) * 100;
}
// Fewer sessions than this on either side and a share is not compared at all.
const MIN_SESSIONS = 100;
// Counts such as sessions per period: the normal spread of a count is about its square root.
const countNoise = (a, b) => 2.58 * Math.sqrt(a + b);
// Everyday ups and downs of a daily number, from its last four weeks (the moving-range method),
// scaled to the length of the period being compared.
function dailyNoise(trend, field, days) {
  const values = trend
    .map((day) => day[field])
    .filter((value) => value != null);
  if (values.length < 8) return 0;
  const ranges = values.slice(1).map((value, i) => Math.abs(value - values[i]));
  const spread =
    ranges.reduce((sum, range) => sum + range, 0) / ranges.length / 1.128;
  return 2.58 * spread * Math.sqrt(2 / days);
}
// Network numbers have no daily history yet, so a change under 10% is treated as noise.
const RELATIVE_NOISE = 0.1;

// What each share is out of, in words.
const BASE_WORDS = {
  stream_drops: "connected sessions",
  connected_no_stats: "connected sessions",
  low_fps: "sessions with readings",
  any_low_fps: "sessions with readings",
  high_skip: "sessions with readings",
};

// One card: heading, number, one line of context, the change and an optional trend line.
// The "i" button explains it; clicking the number opens the sessions behind it.
function Card({
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
  return (
    <article
      className={
        "panel compact-metric" +
        (selected ? " selected" : "") +
        (onOpen ? " clickable" : "")
      }
    >
      <div className="card-head">
        <h3>{title}</h3>
        {hint && <Info topic={title}>{hint}</Info>}
      </div>
      {onOpen ? (
        <button
          className="metric-number"
          aria-pressed={selected}
          aria-label={`${title}: ${value}${unit ? " " + unit : ""}. Show these sessions`}
          onClick={() => onOpen(title)}
        >
          {value}
          {unit && <span className="unit">{unit}</span>}
        </button>
      ) : (
        <strong className="metric-number">
          {value}
          {unit && <span className="unit">{unit}</span>}
        </strong>
      )}
      {note && <small>{note}</small>}
      {change && (
        <small className={"change " + change.tone}>{change.text}</small>
      )}
      {trend}
    </article>
  );
}

// Under a heading that already says it, a filter drops the repeated start:
// "Error: video connection failed" under "Kind of error" reads "Video connection failed".
const REPEATED = {
  "Kind of error": /^Error: /,
  "Where it failed": /^Error in /,
  "How it ended": /^Ended: /,
};
function shortTitle(title, section) {
  const short = REPEATED[section]
    ? title.replace(REPEATED[section], "")
    : title;
  return short[0].toUpperCase() + short.slice(1);
}

// The largest count in a list, so each row's bar shows its share of it.
const most = (items) => Math.max(1, ...items.map((item) => item.count));

// Filters with counts: every tag and reason, counted under the filters already chosen.
// Choosing more than one keeps only sessions that have all of them.
function Filters({ facets, filters, reason, onChange }) {
  const [find, setFind] = useState("");
  const box = useRef(null);
  useEffect(() => {
    function jump(event) {
      const typing = ["INPUT", "SELECT", "TEXTAREA"].includes(
        document.activeElement?.tagName,
      );
      if (
        event.key === "/" &&
        !typing &&
        !document.querySelector("dialog[open]")
      ) {
        event.preventDefault();
        box.current?.focus();
      }
    }
    window.addEventListener("keydown", jump);
    return () => window.removeEventListener("keydown", jump);
  }, []);
  const [expanded, setExpanded] = useState({});
  const toggle = (key) =>
    onChange(
      filters.includes(key)
        ? filters.filter((f) => f !== key)
        : [...filters, key],
      reason,
    );
  const sections = [
    ...facets.sections.map((section) => ({
      title: section.title,
      items: section.tags.map((tag) => ({
        key: tag.key,
        text: shortTitle(tag.title, section.title),
        count: tag.count,
        on: filters.includes(tag.key),
        pick: () => toggle(tag.key),
      })),
    })),
    {
      title: "How far it got",
      items: facets.reasons.map(([text, count]) => ({
        key: text,
        text,
        count,
        on: reason === text,
        pick: () => onChange(filters, reason === text ? "" : text),
      })),
    },
  ];
  const wanted = find.trim().toLowerCase();
  return (
    <aside className="panel filters" aria-label="Filter sessions">
      <h2 className="filters-title">
        Filter sessions
        <Info>
          Every filter, with how many sessions match it under the filters
          already chosen. Picking more than one keeps only sessions that have
          all of them.
        </Info>
      </h2>
      <input
        ref={box}
        type="search"
        aria-label="Find a filter"
        placeholder="Find a filter (press /)"
        value={find}
        onChange={(event) => setFind(event.target.value)}
      />
      {sections.map((section) => {
        const items = section.items.filter((item) =>
          item.text.toLowerCase().includes(wanted),
        );
        if (!items.length) return null;
        const all = wanted || expanded[section.title];
        // Engineering signals stay folded away until someone asks for them.
        if (
          section.title === "Technical signals" &&
          !all &&
          !items.some((item) => item.on)
        )
          return (
            <section key={section.title} className="facet-section">
              <button
                className="link-button"
                onClick={() =>
                  setExpanded({ ...expanded, [section.title]: true })
                }
              >
                Show technical signals ({items.length})
              </button>
            </section>
          );
        const visible = all
          ? items
          : items.filter((item, i) => i < SHOWN || item.on);
        return (
          <section key={section.title} className="facet-section">
            <h3>{section.title}</h3>
            <ul className="facet-list">
              {visible.map((item) => (
                <li key={item.key}>
                  <button
                    aria-pressed={item.on}
                    onClick={item.pick}
                    style={{ "--share": item.count / most(items) }}
                  >
                    <span className="facet-label">
                      <span className="tick" aria-hidden="true">
                        {item.on ? "✓" : ""}
                      </span>
                      <span>{item.text}</span>
                    </span>
                    <span className="count">{number(item.count)}</span>
                  </button>
                </li>
              ))}
            </ul>
            {!wanted && items.length > SHOWN && (
              <button
                className="link-button"
                onClick={() =>
                  setExpanded({ ...expanded, [section.title]: !all })
                }
              >
                {all ? "Show fewer" : `Show all ${items.length}`}
              </button>
            )}
          </section>
        );
      })}
    </aside>
  );
}

function ActiveFilters({ filters, reason, error, titles, sections, onChange }) {
  const sectionOf = Object.fromEntries(
    sections.flatMap((section) =>
      section.tags.map((tag) => [tag.key, section.title]),
    ),
  );
  if (!filters.length && !reason && !error) return null;
  return (
    <div className="active-filters" role="group" aria-label="Active filters">
      <strong>Showing only:</strong>
      {filters.map((key) => (
        <button
          key={key}
          className="chip-button"
          onClick={() =>
            onChange(
              filters.filter((f) => f !== key),
              reason,
            )
          }
          aria-label={`Remove filter ${titles[key] || key}`}
        >
          {sectionOf[key] ? sectionOf[key] + ": " : ""}
          {shortTitle(titles[key] || key, sectionOf[key])} ✕
        </button>
      ))}
      {reason && (
        <button
          className="chip-button"
          onClick={() => onChange(filters, "")}
          aria-label={`Remove filter ${reason}`}
        >
          How far it got: {reason} ✕
        </button>
      )}
      {error && (
        <button
          className="chip-button"
          onClick={() => onChange(filters, reason, null)}
          aria-label={`Remove filter code ${error.code}`}
        >
          Code {error.code} ({EVENTS[error.event] || error.event}):{" "}
          {error.reason || "no reason"}
          {error.afterEnd ? " (after it ended)" : ""} ✕
        </button>
      )}
      <button className="link-button" onClick={() => onChange([], "", null)}>
        Clear all
      </button>
    </div>
  );
}

// A link that runs an action instead of following its href.
const go = (action) => (event) => {
  event.preventDefault();
  action();
};

// The answer in one sentence, before any card.
function Headline({
  summary,
  before,
  facets,
  period,
  versus,
  onClear,
  onReason,
  onOpen,
}) {
  const when =
    period.start === period.end
      ? dateLabel(period.end)
      : `${dateLabel(period.start)} – ${dateLabel(period.end)}`;
  if (!summary.sessions)
    return (
      <p className="panel headline">
        <strong>{when}:</strong> no sessions match. Try another day or All data.{" "}
        {onClear && (
          <button className="link-button" onClick={onClear}>
            Clear filters
          </button>
        )}
      </p>
    );
  const never = summary.groups.no_success.share;
  const neverBefore = before?.groups.no_success.share;
  const problem = facets.reasons.find(([text]) => !NOT_A_PROBLEM.has(text));
  return (
    <p className="panel headline">
      <strong>{when}:</strong>{" "}
      <a className="key-link" href="#" onClick={go(() => onOpen("all"))}>
        {number(summary.sessions)} sessions
      </a>
      .
      {never != null && (
        <>
          {" "}
          <a
            className="key-link"
            href="#"
            onClick={go(() => onOpen("no_success"))}
          >
            {percent(never)}
          </a>{" "}
          of those that tried never connected
          {neverBefore != null && ` (${percent(neverBefore)} ${versus})`}.
        </>
      )}
      {problem && (
        <>
          {" "}
          Most common problem:{" "}
          <a
            className="key-link"
            href="#"
            onClick={go(() => onReason(problem[0]))}
          >
            {problem[0].replace(/^Failed: /, "").replace(/ \(code \d+\)$/, "")}
          </a>{" "}
          <span className="nowrap">— {number(problem[1])} sessions</span>.
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

// Every error code with each reason the app gave, exactly as sent, and how many sessions had it.
function ErrorReasons({ rows, error, onPick }) {
  const codes = new Set(rows.map((row) => row.code));
  return (
    <details className="section">
      <summary>
        Error codes and their reasons
        <span className="summary-hint">
          {rows.length
            ? `${codes.size} codes · ${rows.length} different reasons`
            : "No error codes on these dates"}
        </span>
      </summary>
      {rows.length > 0 && (
        <div className="table-scroll tall">
          <table aria-label="Error codes and their reasons">
            <thead>
              <tr>
                <th scope="col">
                  Code
                  <Info>
                    Click a code or its session count to see those sessions.
                  </Info>
                </th>
                <th scope="col">Where</th>
                <th scope="col">
                  When
                  <Info>
                    Before it ended: a real error. After it ended: the app
                    retried a session that had already closed, so it is not
                    counted as a failure anywhere else on this page.
                  </Info>
                </th>
                <th scope="col">
                  Reason, exactly as the app sent it
                  <Info>
                    The app sends a reason with every error code, and one code
                    can have many reasons. The text is shown unchanged.
                  </Info>
                </th>
                <th scope="col" className="num">
                  Sessions
                  <Info>How many sessions had this code with this reason.</Info>
                </th>
                <th scope="col" className="num">
                  Times
                  <Info>How many times it happened in those sessions.</Info>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.code + row.event + row.reason + row.after_end}
                  className={
                    error?.code === row.code &&
                    error?.event === row.event &&
                    error?.reason === row.reason &&
                    error?.afterEnd === row.after_end
                      ? "open-row"
                      : undefined
                  }
                >
                  <td data-label="Code">
                    <button
                      className="link-button"
                      onClick={() => onPick(row)}
                      aria-label={`Show the ${number(row.sessions)} sessions with code ${row.code} and this reason`}
                    >
                      <strong>{row.code}</strong>
                    </button>
                  </td>
                  <td data-label="Where">{EVENTS[row.event] || row.event}</td>
                  <td data-label="When">
                    {row.after_end
                      ? "After it ended (retry)"
                      : "Before it ended"}
                  </td>
                  <td data-label="Reason">
                    <code>{row.reason || "—"}</code>
                  </td>
                  <td data-label="Sessions" className="num">
                    <button className="link-button" onClick={() => onPick(row)}>
                      {number(row.sessions)}
                    </button>
                  </td>
                  <td data-label="Times" className="num">
                    {number(row.events)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </details>
  );
}

// Grey placeholders while the first numbers load, so the page never jumps.
function Placeholder() {
  return (
    <div
      className="daily-metrics"
      role="status"
      aria-busy="true"
      aria-label="Loading numbers"
    >
      {[1, 2, 3, 4, 5].map((n) => (
        <div key={n} className="panel compact-metric skeleton" />
      ))}
    </div>
  );
}

// The sessions behind a card slide in from the right, over the page, so nothing scrolls away.
function Drawer({ title, onClose, children }) {
  const dialog = useRef(null);
  // Opening moves focus to the list's heading, so nothing is outlined before it is used.
  useEffect(() => {
    dialog.current?.showModal();
    dialog.current?.focus();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="drawer"
      aria-label={title}
      tabIndex={-1}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === dialog.current) dialog.current.close();
      }}
    >
      <button className="drawer-close" onClick={() => dialog.current.close()}>
        Close
      </button>
      {children}
    </dialog>
  );
}

export function DailyImpact({ period, revision }) {
  const fromUrl = readUrl();
  const [category, setCategory] = useState(fromUrl.card || null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState({ key: "", order: "desc" });
  const [from, setFrom] = useState(null);
  const [filters, setFilters] = useState(
    fromUrl.filters ? fromUrl.filters.split(",") : [],
  );
  const [reason, setReason] = useState(fromUrl.reason || "");
  const [error, setError] = useState(
    fromUrl.error_code
      ? {
          code: fromUrl.error_code,
          event: fromUrl.error_event || "",
          reason: fromUrl.error_reason || "",
          afterEnd: fromUrl.error_after_end === "1",
        }
      : null,
  );
  const [shown, setShown] = useState(null);
  const [retry, setRetry] = useState(0);

  // A new date starts from the first page with no search.
  useEffect(() => {
    setPage(1);
    setSearch("");
    setSort({ key: "", order: "desc" });
  }, [period]);

  // Keep the address bar in step with the page, and follow it on Back and Forward.
  useEffect(() => {
    writeUrl({
      card: category,
      filters: filters.join(","),
      reason,
      error_code: error?.code,
      error_event: error?.event,
      error_reason: error?.reason,
      error_after_end: error ? (error.afterEnd ? "1" : "0") : "",
      // Closing the list also closes any session opened from it.
      ...(category ? {} : { session: "" }),
    });
  }, [category, filters, reason, error]);
  useEffect(() => {
    function follow() {
      const url = readUrl();
      setCategory(url.card || null);
      setFilters(url.filters ? url.filters.split(",") : []);
      setReason(url.reason || "");
      setError(
        url.error_code
          ? {
              code: url.error_code,
              event: url.error_event || "",
              reason: url.error_reason || "",
              afterEnd: url.error_after_end === "1",
            }
          : null,
      );
      setPage(1);
      setSearch("");
      setSort({ key: "", order: "desc" });
    }
    window.addEventListener("popstate", follow);
    return () => window.removeEventListener("popstate", follow);
  }, []);

  // One request returns the cards, plus the session list once a card is clicked.
  const result = useReport(
    "impact",
    {
      ...period,
      ...(category ? { category } : {}),
      page,
      search,
      filters: filters.join(","),
      reason,
      ...(error
        ? {
            error_code: error.code,
            error_event: error.event,
            error_reason: error.reason,
            error_after_end: error.afterEnd ? "1" : "0",
          }
        : {}),
      ...(category && sort.key ? { sort: sort.key, order: sort.order } : {}),
    },
    revision + retry,
  );

  // While new numbers load, the old ones stay on screen, dimmed, instead of the page emptying.
  // The open list keeps its rows while the next page loads, so the drawer never flickers shut.
  const [list, setList] = useState(null);
  useEffect(() => {
    if (!result.data) return;
    setShown(result.data);
    if (result.data.sessions)
      setList({ category, sessions: result.data.sessions });
  }, [result.data]);
  const data = result.data || shown;

  function open(next, source = null) {
    setFrom(source);
    setCategory(next);
    setPage(1);
    setSearch("");
    setSort({ key: "", order: "desc" });
  }

  function filter(nextFilters, nextReason, nextError = error) {
    setFilters(nextFilters);
    setReason(nextReason);
    setError(nextError);
    setPage(1);
  }

  // Clicking a reason anywhere keeps only those sessions; clicking it again shows them all.
  function pickReason(text) {
    filter(filters, reason === text ? "" : text);
  }

  const days = (new Date(period.end) - new Date(period.start)) / 86400000 + 1;
  const versus =
    days === 1
      ? "the same day last week"
      : days < 7
        ? "the same days a week earlier"
        : days === 7
          ? "the week before"
          : `the ${days} days before`;

  if (!data)
    return (
      <section className="section-block">
        <Notice error={result.error} />
        {result.error && (
          <button
            onClick={() => {
              setCategory(null);
              filter([], "", null);
            }}
          >
            Reset view
          </button>
        )}
        {!result.error && <Placeholder />}
      </section>
    );

  const summary = data.summary;
  const before = data.previous;
  const groups = summary.groups;
  const trendDays = data.trend.length;

  // Card props shared by every card that opens one group. For all of them, fewer is better.
  function group(key) {
    const { share, base } = groups[key];
    const then = before?.groups[key];
    const of = BASE_WORDS[key] || "those who tried";
    return {
      value: number(groups[key].count),
      note: share == null ? null : `${number(share, 1)}% of ${of}`,
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
      hint: `${groups[key].definition} The % is out of ${of}.`,
      selected: category === key,
      onOpen: (from) => open(key, from),
    };
  }

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

  return (
    <section className="section-block">
      {result.error && (
        <p className="notice error" role="alert">
          Couldn&apos;t update: {result.error} Showing the previous numbers.{" "}
          <button
            className="link-button"
            onClick={() => setRetry((n) => n + 1)}
          >
            Try again
          </button>
        </p>
      )}
      <div className="impact-layout">
        <Filters
          facets={data.facets}
          filters={filters}
          reason={reason}
          onChange={filter}
        />

        <div
          className={"impact-main" + (result.loading ? " updating" : "")}
          aria-busy={Boolean(result.loading)}
        >
          <ActiveFilters
            filters={filters}
            reason={reason}
            error={error}
            titles={data.titles}
            sections={data.facets.sections}
            onChange={filter}
          />
          <Headline
            summary={summary}
            before={before}
            facets={data.facets}
            period={period}
            versus={versus}
            onClear={
              filters.length || reason || error
                ? () => filter([], "", null)
                : null
            }
            onReason={pickReason}
            onOpen={open}
          />

          {summary.sessions > 0 && (
            <>
              <h2 className="row-title">
                Headline numbers
                <Info>
                  The small line under each number shows one value per day for
                  the last {trendDays} days, ending on the last selected day
                  (the dot).
                </Info>
              </h2>
              <div className="daily-metrics headline-row">
                <Card
                  title="Sessions"
                  value={number(summary.sessions)}
                  note={
                    <a
                      className="key-link"
                      href="#"
                      onClick={go(() => open("tried", "Sessions"))}
                    >
                      {number(summary.attempted)} tried to connect
                    </a>
                  }
                  change={changeOf(
                    "sessions",
                    plain,
                    null,
                    before ? countNoise(summary.sessions, before.sessions) : 0,
                  )}
                  hint={groups.all.definition}
                  selected={category === "all"}
                  onOpen={(from) => open("all", from)}
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
                  value={
                    summary.ready_p50 == null
                      ? "—"
                      : number(summary.ready_p50, 1)
                  }
                  note={
                    summary.ready_p90 == null
                      ? null
                      : `Typical wait · 1 in 10 waited over ${seconds(summary.ready_p90)}`
                  }
                  change={changeOf(
                    "ready_p50",
                    seconds,
                    false,
                    noiseOf("ready_p50"),
                  )}
                  hint="Time from connecting to the first video frame, for each session's first successful connect. Typical is the middle value: half the sessions waited less. 1 in 10 waited over is the point the slowest 10% waited past."
                  selected={category === "ready"}
                  onOpen={(from) => open("ready", from)}
                  trend={trend("ready_p50", seconds)}
                />
                <Card
                  title="Streamed hours"
                  value={number(summary.streamed_hours, 1)}
                  unit="h"
                  note={`${number(summary.connected - groups.connected_no_stats.count)} of ${number(summary.connected)} connected sessions sent readings`}
                  change={changeOf(
                    "streamed_hours",
                    hours,
                    true,
                    noiseOf("streamed_hours") * days,
                  )}
                  hint={`Counted from the player app's per-second readings: each second a session sent stats counts once. ${number(groups.connected_no_stats.count)} connected sessions sent no stats, so their time isn't counted and the real total is higher.`}
                  selected={category === "measured"}
                  onOpen={(from) => open("measured", from)}
                  trend={trend("streamed_hours", hours)}
                />
                <Card
                  title="Time below 30 FPS"
                  value={
                    summary.low_fps_time_share == null
                      ? "—"
                      : number(summary.low_fps_time_share, 1)
                  }
                  unit={summary.low_fps_time_share == null ? "" : "%"}
                  note={`${hours(summary.low_fps_hours)} of ${hours(summary.streamed_hours)} streamed`}
                  change={changeOf(
                    "low_fps_time_share",
                    percent,
                    false,
                    noiseOf("low_fps_time_share"),
                  )}
                  hint="The share of streamed time where some player's frame rate was under 30. An average FPS hides the bad stretches; this does not. 30 is the idle rate, so only below 30 counts."
                  selected={category === "any_low_fps"}
                  onOpen={(from) => open("any_low_fps", from)}
                  trend={trend("low_fps_time_share", percent)}
                />
              </div>

              <details className="section">
                <summary>
                  Connection details
                  <span className="summary-hint">
                    {number(groups.failure.count)} had a connection error ·{" "}
                    {number(groups.repeated_attempts.count)} needed more than
                    one attempt · {number(groups.stream_drops.count)} lost video
                    while playing
                  </span>
                </summary>
                <div className="daily-metrics">
                  <Card title="Had a connection error" {...group("failure")} />
                  <Card
                    title="More than one attempt"
                    {...group("repeated_attempts")}
                  />
                  <Card
                    title="Lost video while playing"
                    {...group("stream_drops")}
                  />
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
                  <Card
                    title="Sessions averaging under 30 FPS"
                    {...group("low_fps")}
                  />
                  <Card
                    title="Average FPS"
                    value={
                      summary.fps_mean == null ? "—" : plain(summary.fps_mean)
                    }
                    change={changeOf(
                      "fps_mean",
                      plain,
                      true,
                      noiseOf("fps_mean"),
                    )}
                    hint="Every per-second FPS reading from every session, added up and divided by how many readings there are. 30 is the idle rate, so idle desktops pull this towards 30."
                    selected={category === "fps"}
                    onOpen={(from) => open("fps", from)}
                  />
                  <Card title="Many skipped frames" {...group("high_skip")} />
                </div>
              </details>

              <details className="section">
                <summary>
                  Network and device
                  <span className="summary-hint">
                    {summary.measures.latency
                      ? `Typical delay ${number(summary.measures.latency.typical, 0)} ms`
                      : "No readings"}
                    {summary.measures.downloadSpeed &&
                      ` · typical download speed ${number(summary.measures.downloadSpeed.typical, 1)} Mbps`}
                  </span>
                </summary>
                <div className="daily-metrics">
                  {NETWORK.map(([key, title, unit, higherIsBetter, what]) => {
                    const now = summary.measures[key];
                    const then = before?.measures?.[key];
                    return (
                      <Card
                        key={key}
                        title={title}
                        value={now ? number(now.typical, 1) : "—"}
                        unit={now ? unit.trim() : ""}
                        note={
                          now &&
                          (higherIsBetter
                            ? `Typical session · 1 in 10 below ${number(now.low_tenth, 1)}${unit}`
                            : `Typical session · 1 in 10 above ${number(now.high_tenth, 1)}${unit}`)
                        }
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
                        hint={`${what} Shown for the typical session: each session's own average, then the middle one of ${number(now?.sessions)} sessions. The plain average of every reading is ${now ? number(now.average, 1) + unit : "—"}; a few sessions with big spikes pull that up. Units are read from the values; the app does not document them.`}
                      />
                    );
                  })}
                </div>
              </details>

              <details className="section">
                <summary>
                  More breakdowns
                  <span className="summary-hint">
                    {BREAKDOWNS.length} more lists of sessions
                  </span>
                </summary>
                <div className="preset-buttons">
                  {BREAKDOWNS.map((key) => (
                    <button key={key} onClick={() => open(key)}>
                      {groups[key].title}: {number(groups[key].count)}
                    </button>
                  ))}
                </div>
              </details>

              <ErrorReasons
                rows={data.error_reasons}
                error={error}
                onPick={(row) => {
                  filter(filters, reason, {
                    code: row.code,
                    event: row.event,
                    reason: row.reason,
                    afterEnd: row.after_end,
                  });
                  open("all");
                }}
              />
            </>
          )}

          <details className="section">
            <summary>
              What this data can&apos;t show yet
              <span className="summary-hint">{PENDING.length} known gaps</span>
            </summary>
            <ul>
              {PENDING.map((text) => (
                <li key={text}>{text}</li>
              ))}
            </ul>
          </details>
        </div>
      </div>

      {category && groups[category] && (
        <Drawer
          title={groups[category].title}
          onClose={() => setCategory(null)}
        >
          <Notice error={result.error} />
          {list?.category !== category ? (
            <Notice loading>Loading sessions…</Notice>
          ) : (
            <AffectedSessions
              key={category + period.start + period.end}
              category={category}
              reason={reason}
              onReason={pickReason}
              group={groups[category]}
              sessions={list.sessions}
              busy={Boolean(result.loading)}
              sort={sort}
              onSort={(next) => {
                setSort(next);
                setPage(1);
              }}
              scope={[
                period.start === period.end
                  ? dateLabel(period.end)
                  : `${dateLabel(period.start)} – ${dateLabel(period.end)}`,
                ...filters.map((key) => data.titles[key] || key),
                reason,
                error &&
                  `code ${error.code}: ${error.reason || "no reason"}${error.afterEnd ? " (after it ended)" : ""}`,
              ]
                .filter(Boolean)
                .join(" · ")}
              from={from}
              errorView={Boolean(error || reason)}
              period={period}
              search={search}
              onSearch={(text) => {
                setSearch(text);
                setPage(1);
              }}
              page={page}
              onPage={setPage}
            />
          )}
        </Drawer>
      )}
    </section>
  );
}
