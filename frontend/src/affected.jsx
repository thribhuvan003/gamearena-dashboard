import React, { useEffect, useState } from "react";
import { Info, Pages, number, utcTime } from "./format";
import { readUrl, writeUrl } from "./url";
import { SessionDetail } from "./sessions";

// Quality lists need the stream numbers; connection lists need how far the session got.
const QUALITY = new Set([
  "fps",
  "low_fps",
  "any_low_fps",
  "measured",
  "high_skip",
]);

// A session with no stats has no streamed time; show a dash, not "0 min".
function minutes(row, key) {
  const measured = row.batches > 0 || row.streamed_seconds > 0;
  return measured ? number(row[key] / 60, 1) + " min" : "—";
}

// What each column means, shown by its "i" button.
const NOTES = {
  "Session ID":
    "The session's ID. Copy it to look the session up anywhere else.",
  "First event": "Time of the session's first event (UTC).",
  Streamed:
    "Seconds the player app sent stats for, in minutes. A dash means it sent none.",
  "Avg FPS":
    "All of this session's per-second FPS readings, added up and divided by how many there are.",
  "Time under 30 FPS": "Minutes where FPS was under 30.",
  Attempts: "How many times the app tried to connect.",
  "Times video was lost": "Times the video connection was lost while playing.",
  "Time with many skipped frames":
    "Minutes with 10 or more skipped frames in a second.",
  "Time to video":
    "Time from connecting to the first video frame, for the first successful connect.",
  "How far it got":
    "Our plain-words summary of how far the session got. Open the details for the app's own message.",
};

const ID = /^[0-9a-f-]{36}$/;

// Columns holding numbers line up on the right, so they compare at a glance.
const NUMERIC = new Set([
  "Streamed",
  "Avg FPS",
  "Time under 30 FPS",
  "Attempts",
  "Times video was lost",
  "Time with many skipped frames",
  "Time to video",
]);

// Columns the list can be sorted by, and the name the server knows each by.
const SORTS = {
  "First event": "first_seen",
  Streamed: "streamed",
  "Avg FPS": "fps",
  "Time under 30 FPS": "low_fps",
  Attempts: "attempts",
  "Times video was lost": "drops",
  "Time with many skipped frames": "skipped",
  "Time to video": "wait",
};

const COLUMNS = {
  "First event": (row) => (
    <span className="nowrap">{utcTime(row.first_seen)}</span>
  ),
  Streamed: (row) => minutes(row, "streamed_seconds"),
  "Avg FPS": (row) => number(row.fps_mean, 1),
  "Time under 30 FPS": (row) => minutes(row, "low_fps_seconds"),
  Attempts: (row) => number(row.attempts),
  "Times video was lost": (row) => number(row.stream_drops),
  "Time with many skipped frames": (row) => minutes(row, "high_skip_seconds"),
  "Time to video": (row) =>
    row.first_ready_ms == null
      ? "—"
      : number(row.first_ready_ms / 1000, 1) + " s",
  "How far it got": (row) => row.why,
};

// Lists about failing to connect: video and stream numbers would only be dashes or noise.
const CONNECTING = new Set([
  "no_success",
  "failure",
  "later_success",
  "no_later_success",
  "failure_after_end",
  "repeated_attempts",
  "tried",
]);

function columnsFor(category, errorView) {
  if (category === "stats_only") return ["Streamed", "Avg FPS"];
  if (errorView || CONNECTING.has(category))
    return ["First event", "Attempts", "How far it got"];
  if (category === "all")
    return [
      "First event",
      "Attempts",
      "Time to video",
      "Streamed",
      "How far it got",
    ];
  if (category === "all") return Object.keys(COLUMNS);
  if (category === "stream_drops")
    return [
      "First event",
      "Streamed",
      "Times video was lost",
      "How far it got",
    ];
  if (category === "high_skip")
    return [
      "First event",
      "Streamed",
      "Avg FPS",
      "Time with many skipped frames",
    ];
  if (category === "ready")
    return ["First event", "Time to video", "Attempts", "How far it got"];
  if (QUALITY.has(category))
    return ["First event", "Streamed", "Avg FPS", "Time under 30 FPS"];
  return ["First event", "Attempts", "How far it got"];
}

// The sessions behind one card. The backend uses the same rule for the count and the list.
export function AffectedSessions({
  category,
  group,
  sessions,
  period,
  search,
  onSearch,
  page,
  onPage,
  busy,
  sort,
  onSort,
  scope,
  reason,
  onReason,
  from,
  errorView,
}) {
  const [session, setOpenSession] = useState(() =>
    ID.test(readUrl().session || "") ? readUrl().session : null,
  );
  // The open session lives in the address bar, so a link opens it and Back closes it.
  function setSession(id) {
    setOpenSession(id);
    writeUrl({ session: id });
  }
  useEffect(() => {
    function follow() {
      const id = readUrl().session || "";
      setOpenSession(ID.test(id) ? id : null);
    }
    window.addEventListener("popstate", follow);
    return () => window.removeEventListener("popstate", follow);
  }, []);
  const [copied, setCopied] = useState(null);
  // A column that is empty on every row of this page is left out; it would only show dashes.
  const columns = columnsFor(category, errorView).filter(
    (label) =>
      !sessions.items.length ||
      sessions.items.some((row) => COLUMNS[label](row) !== "—"),
  );

  // Show "Copied" on the row for two seconds, so the click visibly worked.
  function copy(id) {
    navigator.clipboard?.writeText(id).then(() => {
      setCopied(id);
      setTimeout(
        () => setCopied((current) => (current === id ? null : current)),
        2000,
      );
    });
  }

  return (
    <article
      className={busy ? "updating" : undefined}
      aria-busy={Boolean(busy)}
    >
      <h2 tabIndex={-1} className="panel-title">
        {group.title}: {number(group.count)}
      </h2>
      <p>{group.definition}</p>
      {from && from !== group.title && (
        <p className="scope">From the &quot;{from}&quot; card.</p>
      )}
      <p className="scope">
        Showing: {scope}. Each row counts the whole session, even outside these
        dates.
      </p>

      {/* Where these sessions stopped, counted over the whole list, not just this page. */}
      {!QUALITY.has(category) && (
        <h3 className="subhead">How far these sessions got</h3>
      )}
      {!QUALITY.has(category) && (
        <ul className="reasons">
          {sessions.reasons.map(([text, count]) => (
            <li key={text}>
              <button
                className="reason-button"
                aria-pressed={reason === text}
                onClick={() => onReason(text)}
                style={{
                  "--share":
                    count / Math.max(1, ...sessions.reasons.map(([, n]) => n)),
                }}
              >
                <span>{text}</span>
                <strong>{number(count)}</strong>
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="list-toolbar">
        <p>
          {sort.key
            ? `Sorted by ${Object.keys(SORTS).find((label) => SORTS[label] === sort.key)}, ${sort.order === "desc" ? "highest first" : "lowest first"}.`
            : sessions.order + "."}
        </p>
        <form
          className="search-form"
          role="search"
          onSubmit={(event) => {
            event.preventDefault();
            const text = new FormData(event.currentTarget).get("search");
            onSearch(text.trim().toLowerCase());
          }}
        >
          <input
            name="search"
            type="search"
            maxLength={36}
            defaultValue={search}
            aria-label="Find a session by its ID"
            placeholder="Find a session ID"
          />
          <button>Find</button>
        </form>
      </div>
      <div className="table-scroll">
        <table aria-label={group.title}>
          <thead>
            <tr>
              {["Session ID", ...columns, ""].map((label) => (
                <th
                  key={label}
                  scope="col"
                  className={NUMERIC.has(label) ? "num" : undefined}
                  aria-sort={
                    SORTS[label] && sort.key === SORTS[label]
                      ? sort.order === "asc"
                        ? "ascending"
                        : "descending"
                      : undefined
                  }
                >
                  {SORTS[label] ? (
                    <button
                      className="sort-button"
                      type="button"
                      onClick={() =>
                        onSort({
                          key: SORTS[label],
                          // A new column starts highest first; clicking it again flips the order.
                          order:
                            sort.key === SORTS[label] && sort.order === "desc"
                              ? "asc"
                              : "desc",
                        })
                      }
                    >
                      {label}
                      <span aria-hidden="true">
                        {sort.key === SORTS[label]
                          ? sort.order === "desc"
                            ? " ▼"
                            : " ▲"
                          : " ↕"}
                      </span>
                    </button>
                  ) : (
                    label
                  )}
                  {NOTES[label] && <Info topic={label}>{NOTES[label]}</Info>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {/* Each row is named by its session, so a screen reader moving between rows hears which one. */}
            {sessions.items.map((row) => (
              <tr
                key={row.session_id}
                aria-label={`Session ${row.session_id.slice(0, 8)}`}
                className={
                  (session === row.session_id ? "open-row " : "") +
                  (category !== "stats_only" ? "clickable-row" : "")
                }
                onClick={() =>
                  category !== "stats_only" && setSession(row.session_id)
                }
              >
                <td data-label="Session ID">
                  <code className="session-id" title={row.session_id}>
                    {row.session_id.slice(0, 8)}…
                  </code>
                  <button
                    className="copy-id"
                    onClick={(event) => {
                      event.stopPropagation();
                      copy(row.session_id);
                    }}
                    aria-label={`${copied === row.session_id ? "Copied" : "Copy"} session ID ${row.session_id.slice(0, 8)}`}
                  >
                    {copied === row.session_id ? "Copied" : "Copy"}
                  </button>
                </td>
                {columns.map((label) => (
                  <td
                    key={label}
                    data-label={label}
                    className={NUMERIC.has(label) ? "num" : undefined}
                  >
                    {COLUMNS[label](row)}
                  </td>
                ))}
                <td data-label="">
                  {/* It opens a pop-up rather than switching something on, so it says so;
                      the open session's row is marked by its highlight instead. */}
                  {category !== "stats_only" && (
                    <button
                      className="open-link"
                      aria-haspopup="dialog"
                      aria-label={`Open session ${row.session_id.slice(0, 8)}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        setSession(row.session_id);
                      }}
                    >
                      Open ›
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!sessions.items.length && (
        <p>
          {search
            ? `No session ID contains "${search}". Clear the search to see all.`
            : "No matching sessions."}
        </p>
      )}
      <Pages
        data={sessions}
        page={page}
        onChange={onPage}
        busy={busy}
        noun="sessions"
      />

      {session && (
        <SessionDetail
          key={session + period.start + period.end}
          id={session}
          period={period}
          onClose={() => setSession(null)}
        />
      )}
    </article>
  );
}
