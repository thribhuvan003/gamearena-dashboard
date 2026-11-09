import React, { useEffect, useState } from "react";
import { useReport } from "./api";
import { AffectedSessions } from "./affected";
import { Notice, number } from "./format";

// Asked for in review, but the data cannot answer them yet.
const PENDING = [
  "High skipped frames uses a proposed rule (10+ per second, for 10% of the time). The team should confirm it.",
  "Device and browser: not in this data. The team needs to share the table that has them.",
  "Idle or in game: no marker, so 30 FPS on a desktop and in a game look the same.",
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

// One small card: heading, number, one line of context and the change.
// The definition shows on hover; clicking the number opens the sessions behind it.
function Card({ title, value, note, change, hint, selected, onOpen }) {
  return (
    <article
      className={"panel compact-metric" + (selected ? " selected" : "")}
      title={hint}
    >
      <h3>{title}</h3>
      <button
        className="metric-number"
        aria-pressed={selected}
        onClick={onOpen}
      >
        {value}
      </button>
      {note && <small>{note}</small>}
      {change && <small className="change">{change}</small>}
    </article>
  );
}

// Filters with counts: every tag and reason, counted under the filters already chosen.
// Choosing more than one tag keeps only sessions that have all of them.
function Filters({ facets, filters, reason, onChange }) {
  const titles = Object.fromEntries(
    facets.sections.flatMap((section) =>
      section.tags.map((t) => [t.key, t.title]),
    ),
  );
  const toggle = (key) =>
    onChange(
      filters.includes(key)
        ? filters.filter((f) => f !== key)
        : [...filters, key],
      reason,
    );
  const active = filters.length + (reason ? 1 : 0);
  return (
    <section className="panel" aria-label="Filter sessions">
      {active > 0 && (
        <div className="preset-buttons active-filters">
          <strong>Showing only:</strong>
          {filters.map((key) => (
            <button key={key} aria-pressed onClick={() => toggle(key)}>
              {titles[key] || key} ✕
            </button>
          ))}
          {reason && (
            <button aria-pressed onClick={() => onChange(filters, "")}>
              {reason} ✕
            </button>
          )}
          <button onClick={() => onChange([], "")}>Clear all</button>
        </div>
      )}
      <details>
        <summary>Filter sessions{active ? ` (${active} active)` : ""}</summary>
        {facets.sections.map((section) => (
          <React.Fragment key={section.title}>
            <h4>{section.title}</h4>
            <div className="preset-buttons">
              {section.tags.map((tag) => (
                <button
                  key={tag.key}
                  aria-pressed={filters.includes(tag.key)}
                  onClick={() => toggle(tag.key)}
                >
                  {tag.title} ({number(tag.count)})
                </button>
              ))}
            </div>
          </React.Fragment>
        ))}
        <h4>Where it stopped</h4>
        <div className="preset-buttons">
          {facets.reasons.map(([text, count]) => (
            <button
              key={text}
              aria-pressed={reason === text}
              onClick={() => onChange(filters, reason === text ? "" : text)}
            >
              {text} ({number(count)})
            </button>
          ))}
        </div>
      </details>
    </section>
  );
}

// Plain words with the old value and whether that is good news,
// e.g. "▲ up from 9.6 s the day before · worse". Session counts have no good direction.
function difference(now, before, format, versus, higherIsBetter) {
  if (now == null || before == null) return null;
  if (format(now) === format(before)) return `Same as ${versus}`;
  const up = now > before;
  const verdict =
    higherIsBetter == null
      ? ""
      : up === higherIsBetter
        ? " · better"
        : " · worse";
  return `${up ? "▲ up" : "▼ down"} from ${format(before)} ${versus}${verdict}`;
}

const percent = (value) => number(value, 1) + "%";
const seconds = (value) => number(value, 1) + " s";
const hours = (value) => number(value, 1) + " h";
const plain = (value) => number(value, 1);

export function DailyImpact({ period, revision }) {
  const [category, setCategory] = useState(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState([]);
  const [reason, setReason] = useState("");

  // A new date starts from the first page with no search.
  useEffect(() => {
    setPage(1);
    setSearch("");
  }, [period]);

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
    },
    revision,
  );

  function open(next) {
    setCategory(next);
    setPage(1);
    setSearch("");
  }

  const data = result.data;
  const summary = data?.summary;
  const before = data?.previous;
  const groups = summary?.groups;
  const days = (new Date(period.end) - new Date(period.start)) / 86400000 + 1;
  const versus = days === 1 ? "the day before" : `the ${days} days before`;

  // Card props shared by every card that opens one group. For all of them, fewer is better.
  function group(key, of = "sessions that tried") {
    const share = groups[key].share;
    return {
      value: number(groups[key].count),
      note: share == null ? null : `${number(share, 1)}% of ${of}`,
      change:
        before &&
        difference(share, before.groups[key].share, percent, versus, false),
      hint: groups[key].definition,
      selected: category === key,
      onOpen: () => open(key),
    };
  }

  function changeOf(key, format, higherIsBetter) {
    return (
      before &&
      difference(summary[key], before[key], format, versus, higherIsBetter)
    );
  }

  return (
    <section className="section-block">
      <Notice error={result.error} loading={result.loading}>
        Calculating…
      </Notice>
      {summary && (
        <>
          <Filters
            facets={data.facets}
            filters={filters}
            reason={reason}
            onChange={(nextFilters, nextReason) => {
              setFilters(nextFilters);
              setReason(nextReason);
              setPage(1);
            }}
          />
          <h2 className="row-title">Connection</h2>
          <div className="daily-metrics">
            <Card
              title="Sessions"
              value={number(summary.sessions)}
              note={`${number(summary.attempted)} tried to connect`}
              change={changeOf("sessions", plain, null)}
              hint={groups.all.definition}
              selected={category === "all"}
              onOpen={() => open("all")}
            />
            <Card title="Never connected" {...group("no_success")} />
            <Card title="Connection failures" {...group("failure")} />
            <Card title="Multiple attempts" {...group("repeated_attempts")} />
            <Card
              title="Wait until video starts"
              value={`${number(summary.ready_p50, 1)} s`}
              note={`Typical wait. 1 in 10 waited over ${number(summary.ready_p90, 1)} s`}
              change={changeOf("ready_p50", seconds, false)}
              hint={groups.ready.definition}
              selected={category === "ready"}
              onOpen={() => open("ready")}
            />
          </div>

          <h2 className="row-title">Stream quality</h2>
          <div className="daily-metrics">
            <Card
              title="Streamed hours"
              value={number(summary.streamed_hours, 1) + " h"}
              note={`From ${number(summary.connected - groups.connected_no_stats.count)} of ${number(summary.connected)} connected sessions. The other ${number(groups.connected_no_stats.count)} sent no stats, so their time isn't counted.`}
              change={changeOf("streamed_hours", hours, true)}
              hint="Counted from the player app's performance readings, one per second. Sessions whose app sent none add nothing, so the real total is higher."
              selected={category === "measured"}
              onOpen={() => open("measured")}
            />
            <Card
              title="Average FPS"
              value={number(summary.fps_mean, 1)}
              change={changeOf("fps_mean", plain, true)}
              hint="Sum of all FPS readings divided by their count."
              selected={category === "fps"}
              onOpen={() => open("fps")}
            />
            <Card title="Below 30 FPS" {...group("low_fps", "sessions")} />
            <Card
              title="Time below 30 FPS"
              value={number(summary.low_fps_hours, 1) + " h"}
              note={`${number(summary.low_fps_time_share, 1)}% of streamed time`}
              change={changeOf("low_fps_time_share", percent, false)}
              hint={groups.any_low_fps.definition}
              selected={category === "any_low_fps"}
              onOpen={() => open("any_low_fps")}
            />
            <Card
              title="Stream dropped while playing"
              {...group("stream_drops")}
            />
            <Card
              title="High skipped frames"
              {...group("high_skip", "sessions")}
            />
          </div>

          <details className="panel">
            <summary>More breakdowns</summary>
            <div className="preset-buttons">
              {BREAKDOWNS.map((key) => (
                <button key={key} onClick={() => open(key)}>
                  {groups[key].title}: {number(groups[key].count)}
                </button>
              ))}
            </div>
            <ul>
              {PENDING.map((text) => (
                <li key={text}>{text}</li>
              ))}
            </ul>
          </details>

          {category && data.sessions && (
            <AffectedSessions
              key={category + period.start + period.end}
              category={category}
              group={groups[category]}
              sessions={data.sessions}
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
        </>
      )}
    </section>
  );
}
