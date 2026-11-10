// The main page: headline sentence, headline cards with trend lines, the two charts, the
// detail sections, the error table, the filter panel, and the drawer with a card's sessions.
import React, { useEffect, useId, useRef, useState } from "react";
import { useReport } from "./api";
import { AffectedSessions } from "./affected";
import {
  Info,
  Notice,
  clickedOutside,
  dateLabel,
  number,
  plural,
} from "./format";
import { readUrl, writeUrl } from "./url";
import {
  OUTCOME_COLOURS,
  RankedBars,
  Sparkline,
  StackedBar,
  reasonColour,
} from "./charts";
import {
  MIN_SESSIONS,
  RELATIVE_NOISE,
  countNoise,
  dailyNoise,
  shareNoise,
} from "./noise";

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

// An open filter section shows its biggest six until "Show N more" is clicked. Fewer than six
// is too few to scan, many more makes the panel long.
const SHOWN = 6;
// The sections most questions start from stay open; the rest fold under "More filters".
const MAIN_SECTIONS = ["Connection", "Kind of error", "Where it failed"];

// How each kind of number is written, one decimal each.
const percent = (value) => number(value, 1) + "%";
const seconds = (value) => number(value, 1) + " s";
const hours = (value) => number(value, 1) + " h";
const plain = (value) => number(value, 1);

// The dates in words: one day, or the first and last.
const datesText = (period) =>
  period.start === period.end
    ? dateLabel(period.end)
    : `${dateLabel(period.start)} – ${dateLabel(period.end)}`;

// What the selected dates are compared with, in words.
function versusWords(days) {
  if (days === 1) return "the same day last week";
  if (days < 7) return "the same days a week earlier";
  if (days === 7) return "the week before";
  return `the ${days} days before`;
}

// Plain words with the old value and whether that is good news,
// e.g. "▲ Worse · was 9.6 s the same day last week". Session counts have no good direction,
// so they read "▲ Up" or "▼ Down" instead.
function difference(
  now,
  before,
  format,
  versus,
  higherIsBetter,
  noise = 0,
  tooFew = false,
) {
  // Nothing to compare with: no line at all.
  if (now == null || before == null) return null;
  if (tooFew)
    return { text: `Too few sessions to compare with ${versus}`, tone: "" };
  // Inside the normal day-to-day range, a change is not a change. Nor is one too small
  // to show once rounded. Either way the line just gives the old value, e.g.
  // "Same day last week: 9.6 s".
  if (format(now) === format(before) || Math.abs(now - before) <= noise)
    return {
      text: `${versus.replace(/^the (.)/, (_, first) => first.toUpperCase())}: ${format(before)}`,
      tone: "",
    };
  // Better or worse depends on which way is good for this number; with no good way
  // (higherIsBetter is null) it is only up or down.
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

// What each share is out of, in words. Any group not listed is out of those who tried
// to connect.
const BASE_WORDS = {
  stream_drops: "connected sessions",
  connected_no_stats: "connected sessions",
  low_fps: "sessions with readings",
  any_low_fps: "sessions with readings",
  high_skip: "sessions with readings",
};

// The error picked in the error table, as kept in the address bar. An error is picked by its
// event; the code can be empty, because some error events carry none.
function errorFrom(url) {
  return url.error_event
    ? {
        code: url.error_code || "",
        event: url.error_event,
        stage: url.error_stage || "",
        phase: url.error_phase || "",
        reason: url.error_reason || "",
        afterEnd: url.error_after_end === "1",
      }
    : null;
}
// The picked error as address-bar and request parameters. With no error every value is
// undefined, which clears it from the address bar and leaves it out of the request.
const errorParams = (error) => ({
  error_code: error?.code,
  error_event: error?.event,
  error_stage: error?.stage,
  error_phase: error?.phase,
  error_reason: error?.reason,
  error_after_end: error ? (error.afterEnd ? "1" : "0") : undefined,
});
// How the picked error reads in a chip or a title: what the telemetry says, as sent.
const errorText = (error) =>
  [
    error.event,
    error.code && "code " + error.code,
    error.stage,
    error.phase,
    error.reason ? `"${error.reason}"` : "",
    error.afterEnd && "after it ended",
  ]
    .filter(Boolean)
    .join(" · ");

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
function Charts({ groups, reasons, reason, category, onOpen, onReason }) {
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
      <div className="card-head">
        <h3>{title}</h3>
        {hint && <Info topic={title}>{hint}</Info>}
      </div>
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
  // Event names stay exactly as sent; only plain words get a capital.
  return /^[a-z]+\.[a-z]/.test(short)
    ? short
    : short[0].toUpperCase() + short.slice(1);
}

// Filters with counts: every tag and reason, counted under the filters already chosen.
// Choosing more than one keeps only sessions that have all of them.
function Filters({ facets, filters, reason, onChange }) {
  // The "Find a filter" box narrows every section to rows containing its text.
  const [find, setFind] = useState("");
  const box = useRef(null);
  // Pressing / jumps to the find box, as on many sites, unless someone is typing
  // in another box or a dialog is open over the page.
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
  // Whether "More filters" is open.
  const [more, setMore] = useState(false);
  const moreId = useId();
  // A tag is added or taken away; the "How far it got" choice stays as it is.
  const toggle = (key) =>
    onChange(
      filters.includes(key)
        ? filters.filter((f) => f !== key)
        : [...filters, key],
      reason,
    );
  // The server's tag sections, then "How far it got". Every session has exactly one
  // reason, so only one can be picked; picking it again lets it go.
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
  // Each section with only the rows that match the search; one with no match disappears.
  const matching = sections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) =>
        item.text.toLowerCase().includes(wanted),
      ),
    }))
    .filter((section) => section.items.length);
  const main = matching.filter((s) => MAIN_SECTIONS.includes(s.title));
  const rest = matching.filter((s) => !MAIN_SECTIONS.includes(s.title));
  // How many picks sit under "More filters", so a folded pick is never missed.
  const active = rest.reduce(
    (sum, s) => sum + s.items.filter((item) => item.on).length,
    0,
  );
  // A pick inside "More filters" opens it, so the pick stays visible and unpicking it never
  // pulls the focused button away. Searching looks through every section, folded or not.
  useEffect(() => {
    if (active > 0) setMore(true);
  }, [active > 0]);
  const restShown = more || wanted ? rest : [];
  const draw = (section) => (
    <FacetSection
      key={section.title}
      title={section.title}
      items={section.items}
      searching={Boolean(wanted)}
    />
  );
  return (
    <aside className="panel filters" aria-label="Filter sessions">
      <h2 className="filters-title">
        Filter sessions
        <Info topic="Filter sessions">
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
      {main.map(draw)}
      {/* While searching every match is already shown, so there is nothing to unfold. */}
      {rest.length > 0 && !wanted && (
        <button
          type="button"
          className="facet-toggle"
          aria-expanded={more}
          aria-controls={moreId}
          onClick={() => setMore(!more)}
        >
          More filters
          {active > 0 && <span className="facet-active">{active} active</span>}
        </button>
      )}
      <div id={moreId}>{restShown.map(draw)}</div>
    </aside>
  );
}

// One filter section: its rows, largest first as the server sends them, each with its count
// and a faint bar for its share of the section's largest.
function FacetSection({ title, items, searching }) {
  // Whether "Show N more" is on.
  const [all, setAll] = useState(false);
  const listId = useId();
  // Folded, the section shows its biggest few plus any picked row, so a pick never hides
  // and never moves. A button that would hide a single row takes that row's room, so then
  // every row shows.
  const top = items.filter((item, i) => i < SHOWN || item.on);
  const hidden = items.length - top.length;
  const fold = !searching && hidden > 1;
  const visible = fold && !all ? top : items;
  const largest = Math.max(1, ...items.map((item) => item.count));
  return (
    <section className="facet-section">
      <h3>{title}</h3>
      <ul id={listId} className="facet-list">
        {visible.map((item) => (
          <li key={item.key}>
            <button
              type="button"
              aria-pressed={item.on}
              onClick={item.pick}
              style={{ "--share": item.count / largest }}
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
      {fold && (
        <button
          type="button"
          className="facet-more"
          aria-expanded={all}
          aria-controls={listId}
          onClick={() => setAll(!all)}
        >
          {all ? "Show fewer" : `Show ${hidden} more`}
        </button>
      )}
    </section>
  );
}

// The "Showing only:" row above the cards: one chip per filter in use, each removing
// itself when clicked, and "Clear all". Hidden when nothing is filtered.
// The chips name the filters the numbers below were counted under (`shown`), which lag the
// panel while new numbers load; removing one takes it from the current choices, so a pick
// made meanwhile is kept.
function ActiveFilters({ shown, current, titles, sections, onChange }) {
  const { filters, reason, error } = shown;
  // Each tag's section title, so a chip can say where its filter came from.
  const sectionOf = Object.fromEntries(
    sections.flatMap((section) =>
      section.tags.map((tag) => [tag.key, section.title]),
    ),
  );
  // Each chip's label names exactly what it shows: "Remove filter <its text>".
  const chips = filters.map((key) => ({
    key,
    text:
      (sectionOf[key] ? sectionOf[key] + ": " : "") +
      shortTitle(titles[key] || key, sectionOf[key]),
    remove: () =>
      onChange(
        current.filters.filter((f) => f !== key),
        current.reason,
      ),
  }));
  if (reason)
    chips.push({
      key: "reason",
      text: "How far it got: " + reason,
      remove: () => onChange(current.filters, ""),
    });
  if (error)
    chips.push({
      key: "error",
      text: errorText(error),
      remove: () => onChange(current.filters, current.reason, null),
    });
  if (!chips.length) return null;
  return (
    <div className="active-filters" role="group" aria-label="Active filters">
      <strong>Showing only:</strong>
      {chips.map((chip) => (
        <button
          type="button"
          key={chip.key}
          className="chip-button"
          onClick={chip.remove}
          aria-label={`Remove filter ${chip.text}`}
        >
          {chip.text} ✕
        </button>
      ))}
      <button
        type="button"
        className="link-button"
        onClick={() => onChange([], "", null)}
      >
        Clear all
      </button>
    </div>
  );
}

// The answer in one sentence, before any card.
// The session count and never-connected share are buttons that open those sessions.
function Headline({ summary, before, when, versus, onClear, onOpen }) {
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

// The error table's columns: [heading, what it means, class].
const ERROR_COLUMNS = [
  [
    "Event",
    "The app's own event name. Click it or its session count to see those sessions.",
  ],
  ["Code"],
  ["Stage", "The part of the app the error came from, as sent."],
  ["Phase", "How far the connection was when it failed, as sent."],
  [
    "When",
    "Before it ended: a real error. After it ended: the app retried a session that had already closed, so it is not counted as a failure anywhere else on this page.",
  ],
  [
    "What the app said",
    "The error's own text, unchanged: its reason or error text, or for a connection state change, the state before and after.",
  ],
  ["Sessions", "How many sessions had this exact error.", "num"],
  ["Times", "How many times it happened in those sessions.", "num"],
];

// Every error event with its code, stage, phase and text, exactly as sent, and how many
// sessions had it.
function ErrorReasons({ rows, error, onPick }) {
  // How many different event names there are, for the line on the folded heading.
  const events = new Set(rows.map((row) => row.event));
  // Whether a row is the error picked now, so that row is highlighted.
  const same = (row) =>
    ["code", "event", "stage", "phase", "reason"].every(
      (key) => error?.[key] === row[key],
    ) && error?.afterEnd === row.after_end;
  return (
    <details className="section">
      <summary>
        Every error, as sent
        <span className="summary-hint">
          {rows.length
            ? `${plural(events.size, "error event")} · ${plural(rows.length, "different combination")} of event, code, stage, phase and text`
            : "No errors on these dates"}
        </span>
      </summary>
      {rows.length > 0 && (
        <div className="table-scroll tall">
          <table aria-label="Every error, as sent">
            <thead>
              <tr>
                {ERROR_COLUMNS.map(([heading, info, className]) => (
                  <th key={heading} scope="col" className={className}>
                    {heading}
                    {info && <Info topic={heading}>{info}</Info>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={[
                    row.event,
                    row.code,
                    row.stage,
                    row.phase,
                    row.reason,
                    row.after_end,
                  ].join("|")}
                  className={same(row) ? "open-row" : undefined}
                >
                  <td data-label="Event">
                    <button
                      type="button"
                      className="link-button"
                      onClick={() => onPick(row)}
                      aria-label={`Show the ${plural(row.sessions, "session")} with this error`}
                    >
                      <code>{row.event}</code>
                    </button>
                  </td>
                  <td data-label="Code">
                    <strong>{row.code || "—"}</strong>
                  </td>
                  <td data-label="Stage">{row.stage || "—"}</td>
                  <td data-label="Phase">{row.phase || "—"}</td>
                  <td data-label="When">
                    {row.after_end
                      ? "After it ended (retry)"
                      : "Before it ended"}
                  </td>
                  <td data-label="What the app said">
                    <code>{row.reason || "—"}</code>
                  </td>
                  <td data-label="Sessions" className="num">
                    <button
                      type="button"
                      className="link-button"
                      onClick={() => onPick(row)}
                    >
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

// The sessions behind a card slide in from the right, over the page, so nothing scrolls away.
function Drawer({ title, onClose, children }) {
  const dialog = useRef(null);
  // Opening moves focus to the drawer itself rather than its first button, so nothing is
  // outlined before it is used; Tab then starts at Close.
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
      // Esc, Close and a click outside all close the dialog itself, so onClose
      // runs the same way for each. The session pop-up inside the drawer sends its own
      // close event up through React, so only this dialog's own close closes the drawer.
      onClose={(event) => {
        if (event.target === dialog.current) onClose();
      }}
      onClick={(event) => {
        if (clickedOutside(event)) dialog.current.close();
      }}
    >
      <button
        type="button"
        className="close-button"
        onClick={() => dialog.current.close()}
      >
        Close
      </button>
      {children}
    </dialog>
  );
}

// No column picked: the session list keeps the order the server gives it.
const NO_SORT = { key: "", order: "desc" };

// Everything under the date picker for the chosen dates. The open card, filters and picked
// error start from the address bar, so a shared link opens the same view.
export function DailyImpact({ period, revision, dataStart }) {
  const fromUrl = readUrl();
  // The group whose sessions are open in the drawer, or null when it is closed.
  const [category, setCategory] = useState(fromUrl.card || null);
  // Page, search and sort of the session list in the drawer.
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState(NO_SORT);
  // The title of the card that opened the list, which the drawer mentions.
  const [from, setFrom] = useState(null);
  // What the whole page is narrowed to: tags, one "how far it got" reason, one error.
  const [filters, setFilters] = useState(
    fromUrl.filters ? fromUrl.filters.split(",") : [],
  );
  const [reason, setReason] = useState(fromUrl.reason || "");
  const [error, setError] = useState(errorFrom(fromUrl));
  // The last numbers that arrived, with the dates and filters they were counted for, kept on
  // screen while new ones load or after a request fails.
  const [shown, setShown] = useState(null);
  // Goes up on "Try again", which asks for the same numbers once more.
  const [retry, setRetry] = useState(0);
  // On narrow screens the filters fold away behind a button.
  const [showFilters, setShowFilters] = useState(false);

  // A new list starts from the first page, with no search or sort.
  function firstPage() {
    setPage(1);
    setSearch("");
    setSort(NO_SORT);
  }

  // A new date starts from the first page with no search or sort.
  useEffect(firstPage, [period]);

  // Keep the address bar in step with the page, and follow it on Back and Forward.
  useEffect(() => {
    writeUrl({
      card: category,
      filters: filters.join(","),
      reason,
      ...errorParams(error),
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
      setError(errorFrom(url));
      // The card a list came from isn't in the address, so it is forgotten.
      setFrom(null);
      firstPage();
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
      ...errorParams(error),
      // Sorting only matters, and is only sent, while a list is open.
      ...(category && sort.key ? { sort: sort.key, order: sort.order } : {}),
    },
    [revision, retry],
  );

  // What the open list is for: the card, dates and filters. A page, search or sort of the
  // same list is not part of it, so the rows stay (dimmed) while the next page loads and the
  // drawer never flickers shut; anything else shows "Loading" rather than another list's rows.
  const listScope = JSON.stringify([period, category, filters, reason, error]);
  // While new numbers load, the old ones stay on screen, dimmed, instead of the page emptying.
  const [list, setList] = useState(null);
  useEffect(() => {
    if (!result.data) return;
    setShown({ data: result.data, period, filters, reason, error });
    if (result.data.sessions)
      setList({ scope: listScope, sessions: result.data.sessions });
  }, [result.data]);
  // The numbers on screen and the choices they were counted for. The headline's dates and the
  // chips are built from these, never from choices whose numbers haven't arrived.
  const view = result.data
    ? { data: result.data, period, filters, reason, error }
    : shown;
  const data = view?.data;

  // Opens a group's sessions in the drawer. `source` is the card title clicked, if any.
  function open(next, source = null) {
    setFrom(source);
    setCategory(next);
    firstPage();
  }

  // Changes what the page is narrowed to; the picked error stays unless one is given.
  // The list goes back to page 1, as the page it was on may no longer exist.
  function filter(nextFilters, nextReason, nextError = error) {
    setFilters(nextFilters);
    setReason(nextReason);
    setError(nextError);
    setPage(1);
  }

  // Picking an error keeps the sessions that had it and lists them.
  function pickError(row) {
    filter(filters, reason, {
      code: row.code,
      event: row.event,
      stage: row.stage,
      phase: row.phase,
      reason: row.reason,
      afterEnd: row.after_end,
    });
    open("all");
  }

  // Clicking a reason anywhere keeps only those sessions; clicking it again shows them all.
  function pickReason(text) {
    filter(filters, reason === text ? "" : text);
  }

  // Until the first numbers arrive: grey placeholders, so the page never jumps, or the
  // error with a way out.
  if (!data)
    return (
      <section className="section-block">
        <Notice error={result.error} />
        {/* Reset drops the open card and every filter, in case the link's choices
            are what the server couldn't answer. */}
        {result.error ? (
          <button
            type="button"
            onClick={() => {
              setCategory(null);
              filter([], "", null);
            }}
          >
            Reset view
          </button>
        ) : (
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
        )}
      </section>
    );

  // How many days the numbers on screen cover, counting both ends; the comparison is the
  // same length.
  const days =
    (new Date(view.period.end) - new Date(view.period.start)) / 86400000 + 1;
  const versus = versusWords(days);
  // The dates in words: the headline's are those of the numbers on screen.
  const when = datesText(view.period);

  const summary = data.summary;
  // The server compares with the same weekdays a week earlier (under 7 days) or the same
  // number of days just before. If that period starts before the data does, it is only
  // partly filled, so no comparison is shown rather than a false "Up".
  const shift = days < 7 ? 7 : days;
  const beforeStart = new Date(Date.parse(view.period.start) - shift * 86400000)
    .toISOString()
    .slice(0, 10);
  const before = dataStart && beforeStart < dataStart ? null : data.previous;
  const groups = summary.groups;

  // Props for a card whose number opens the sessions of one group.
  const opens = (key) => ({
    selected: category === key,
    onOpen: (from) => open(key, from),
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

  return (
    <section className="section-block">
      {/* A failed update keeps the numbers already shown and offers another go. */}
      {result.error && (
        <p className="notice error" role="alert">
          Couldn&apos;t update: {result.error} Showing the previous numbers.{" "}
          <button
            type="button"
            className="link-button"
            onClick={() => setRetry((n) => n + 1)}
          >
            Try again
          </button>
        </p>
      )}
      <div className="impact-layout">
        {/* Only seen on narrow screens; it counts the filters in use while they are hidden. */}
        <button
          type="button"
          className="filters-toggle"
          aria-expanded={showFilters}
          onClick={() => setShowFilters((open) => !open)}
        >
          {showFilters ? "Hide filters" : "Filters"}
          {filters.length > 0 && ` (${filters.length})`}
        </button>
        <div className={"filters-wrap" + (showFilters ? " open" : "")}>
          <Filters
            facets={data.facets}
            filters={filters}
            reason={reason}
            onChange={filter}
          />
        </div>

        {/* "updating" dims the old numbers while new ones load. */}
        <div
          className={"impact-main" + (result.loading ? " updating" : "")}
          aria-busy={Boolean(result.loading)}
        >
          <ActiveFilters
            shown={view}
            current={{ filters, reason }}
            titles={data.titles}
            sections={data.facets.sections}
            onChange={filter}
          />
          <Headline
            summary={summary}
            before={before}
            when={when}
            versus={versus}
            onClear={
              view.filters.length || view.reason || view.error
                ? () => filter([], "", null)
                : null
            }
            onOpen={open}
          />

          {/* With no sessions the headline says so, and nothing else is drawn. */}
          {summary.sessions > 0 && (
            <>
              {/* The five headline cards, each with a trend line. */}
              <div className="daily-metrics headline-row">
                <Card
                  title="Sessions"
                  value={number(summary.sessions)}
                  note={
                    <button
                      type="button"
                      className="link-button key-link"
                      onClick={() => open("tried", "Sessions")}
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
                  change={changeOf(
                    "ready_p50",
                    seconds,
                    false,
                    noiseOf("ready_p50"),
                  )}
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

              <Charts
                groups={groups}
                reasons={data.facets.reasons}
                reason={reason}
                category={category}
                onOpen={open}
                // A reason in the chart narrows the page to it and lists those sessions.
                onReason={(text) => {
                  pickReason(text);
                  open("no_success");
                }}
              />

              {/* Folded sections for detail; each heading gives the key numbers so most
                  people never need to open it. */}
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
                    value={plain(summary.fps_mean)}
                    change={changeOf(
                      "fps_mean",
                      plain,
                      true,
                      noiseOf("fps_mean"),
                    )}
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

              <ErrorReasons
                rows={data.error_events}
                error={error}
                onPick={pickError}
              />
            </>
          )}
        </div>
      </div>

      {/* The drawer opens for any known group; an unknown card in an old link is ignored. */}
      {category && groups[category] && (
        <Drawer
          title={groups[category].title}
          onClose={() => setCategory(null)}
        >
          <Notice error={result.error} />
          {/* Until this list's own rows arrive, say so rather than show another card's, or
              this card's for other dates or filters. */}
          {list?.scope !== listScope ? (
            <Notice loading>Loading sessions…</Notice>
          ) : (
            <AffectedSessions
              // A new card or new dates start the list afresh.
              key={category + period.start + period.end}
              category={category}
              reason={reason}
              onReason={pickReason}
              group={groups[category]}
              sessions={list.sessions}
              busy={Boolean(result.loading)}
              sort={sort}
              // A new sort or search starts again from page 1.
              onSort={(next) => {
                setSort(next);
                setPage(1);
              }}
              // What the list is limited to, in words: the dates and every filter.
              scope={[
                datesText(period),
                ...filters.map((key) => data.titles[key] || key),
                reason,
                error && errorText(error),
              ]
                .filter(Boolean)
                .join(" · ")}
              from={from}
              // With an error or reason picked, the list shows error columns instead.
              errorView={Boolean(error || reason)}
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
