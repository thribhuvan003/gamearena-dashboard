// A card's session list (the drawer): how far those sessions got, then one row per session
// with its outcome and main error, with sorting, search and paging. A row opens the pop-up.
import React, { useEffect, useState } from "react";
import { Info, Pages, number, utcTime } from "./format";
import { readUrl, writeUrl } from "./url";
import { SessionDetail } from "./sessions";
import { RankedBars, reasonColour } from "./charts";
import { useCopy } from "./share";

// The cards about stream quality. Their lists show stream numbers instead of how far each
// session got, and leave out the "How far these sessions got" chart. Connection lists need it.
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
  Started: "When the session's first event was recorded (UTC).",
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
  Outcome:
    "How far the session got, worked out from its events. Open the session for every event as sent.",
  "Main error":
    "The session's most frequent error before it ended, exactly as the app sent it: event, code, stage, phase and its text. ×N is how many times.",
};

// The session open in the address bar, if any. Only something shaped like a session ID is
// used, so a mistyped or edited link opens nothing rather than a broken pop-up.
function sessionInUrl() {
  const id = readUrl().session || "";
  return /^[0-9a-f-]{36}$/.test(id) ? id : null;
}

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
  Started: "first_seen",
  Streamed: "streamed",
  "Avg FPS": "fps",
  "Time under 30 FPS": "low_fps",
  Attempts: "attempts",
  "Times video was lost": "drops",
  "Time with many skipped frames": "skipped",
  "Time to video": "wait",
};

// The session's main error as the telemetry has it: event, code, stage, phase, then its text.
function mainError(row) {
  if (!row.error_event) return "—";
  return (
    <span className="error-cell">
      <span className="error-meta">
        <code>{row.error_event}</code>
        {[row.error_code, row.error_stage, row.error_phase]
          .filter(Boolean)
          .map((part) => " · " + part)
          .join("")}
        {row.error_events > 1 && (
          <span className="times"> ×{number(row.error_events)}</span>
        )}
      </span>
      {row.error_reason && <q className="error-text">{row.error_reason}</q>}
    </span>
  );
}

// How each column shows one row. A dash means no value; that is also how a column that is
// empty on every row is spotted and left out.
const COLUMNS = {
  Started: (row) => <span className="nowrap">{utcTime(row.first_seen)}</span>,
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
  Outcome: (row) => row.why,
  "Main error": mainError,
};

// When it started, how it ended up and its main error; stream lists show stream numbers instead.
// Lists about failing to connect (and error views) skip video and stream numbers:
// they would only be dashes or noise.
function columnsFor(category, errorView) {
  if (category === "stats_only") return ["Streamed", "Avg FPS"];
  if (category === "repeated_attempts")
    return ["Started", "Attempts", "Outcome", "Main error"];
  if (errorView) return ["Started", "Outcome", "Main error"];
  if (category === "stream_drops")
    return ["Started", "Streamed", "Times video was lost", "Main error"];
  if (category === "high_skip")
    return ["Started", "Streamed", "Avg FPS", "Time with many skipped frames"];
  if (category === "ready") return ["Started", "Time to video", "Outcome"];
  if (QUALITY.has(category))
    return ["Started", "Streamed", "Avg FPS", "Time under 30 FPS"];
  return ["Started", "Outcome", "Main error"];
}

// The sessions behind one card. The backend uses the same rule for the count and the list.
export function AffectedSessions({
  category,
  group,
  sessions,
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
  // The open session lives in the address bar, so a link opens it and Back closes it.
  // openSession(null) closes it.
  const [session, setSessionState] = useState(sessionInUrl);
  function openSession(id) {
    setSessionState(id);
    writeUrl({ session: id });
  }
  // Back and Forward change the address without reloading; follow them so the pop-up opens or
  // closes to match.
  useEffect(() => {
    const follow = () => setSessionState(sessionInUrl());
    window.addEventListener("popstate", follow);
    return () => window.removeEventListener("popstate", follow);
  }, []);
  // Which row's Copy ID was pressed and how it went, so only that row's button changes.
  const [copied, copy] = useCopy();
  // Sessions with readings but no activity events have nothing for the pop-up to show, so
  // their rows do not open.
  const opens = category !== "stats_only";
  // The search box follows the search in use, so Back or a new card clears it too.
  const [find, setFind] = useState(search);
  useEffect(() => setFind(search), [search]);
  // A column that is empty on every row of this page is left out; it would only show dashes.
  const columns = columnsFor(category, errorView).filter(
    (label) =>
      !sessions.items.length ||
      sessions.items.some((row) => COLUMNS[label](row) !== "—"),
  );

  return (
    <article
      className={busy ? "updating" : undefined}
      aria-busy={Boolean(busy)}
    >
      {/* While the list reloads it dims, and screen readers are told it is busy. */}
      <h2 className="panel-title">
        {group.title}: {number(group.count)}
      </h2>
      <p>{group.definition}</p>
      {/* When the card that opened this list has a different title from the list, name that card. */}
      {from && from !== group.title && (
        <p className="scope">From the &quot;{from}&quot; card.</p>
      )}
      <p className="scope">
        Sessions active on {scope} (UTC). Each row covers the whole session.
      </p>

      {/* Where these sessions stopped, over the whole list, not just this page.
          Clicking a reason keeps only those sessions; clicking it again shows them all. */}
      {!QUALITY.has(category) && sessions.reasons.length > 1 && (
        <>
          <h3 className="subhead">How far these sessions got</h3>
          <RankedBars
            label="How far these sessions got"
            total={sessions.reasons.reduce((sum, [, n]) => sum + n, 0)}
            rows={sessions.reasons.map(([text, count]) => ({
              key: text,
              label: text,
              count,
              colour: reasonColour(text),
              active: reason === text,
              onClick: () => onReason(text),
            }))}
          />
        </>
      )}

      {/* Above the table: how the list is ordered, and a search by session ID. */}
      <div className="list-toolbar">
        {/* The chosen sort in words, or the server's own default order when none is chosen. */}
        <p>
          {sort.key
            ? `Sorted by ${Object.keys(SORTS).find((label) => SORTS[label] === sort.key)}, ${sort.order === "desc" ? "highest first" : "lowest first"}.`
            : sessions.order + "."}
        </p>
        <form
          className="search-form"
          role="search"
          onSubmit={(event) => {
            // Searches only on Find or Enter, not on every key, in lower case to match how IDs are written.
            event.preventDefault();
            onSearch(find.trim().toLowerCase());
          }}
        >
          <input
            type="search"
            maxLength={36}
            value={find}
            onChange={(event) => setFind(event.target.value)}
            aria-label="Find a session by its ID"
            placeholder="Find a session ID"
          />
          <button type="submit">Find</button>
        </form>
      </div>
      <div className="table-scroll">
        <table aria-label={group.title}>
          <thead>
            <tr>
              {["Session ID", ...columns].map((label) => {
                // Sortable columns get a button in the heading. The arrow shows the current
                // order, and aria-sort tells screen readers the same thing.
                const sorted = SORTS[label] && sort.key === SORTS[label];
                let arrow = " ↕";
                if (sorted) arrow = sort.order === "desc" ? " ▼" : " ▲";
                let ariaSort;
                if (sorted)
                  ariaSort = sort.order === "asc" ? "ascending" : "descending";
                return (
                  <th
                    key={label}
                    scope="col"
                    className={NUMERIC.has(label) ? "num" : undefined}
                    aria-sort={ariaSort}
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
                              sorted && sort.order === "desc" ? "asc" : "desc",
                          })
                        }
                      >
                        {label}
                        <span aria-hidden="true">{arrow}</span>
                      </button>
                    ) : (
                      label
                    )}
                    {NOTES[label] && <Info topic={label}>{NOTES[label]}</Info>}
                  </th>
                );
              })}
              {/* The Open column needs no visible heading, but screen readers still hear one. */}
              <th scope="col">
                <span className="visually-hidden">Open</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {sessions.items.map((row) => {
              const id = row.session_id;
              // Only the row whose ID was just copied shows the result; every other row says Copy ID.
              const copyLabel =
                (copied.key === id && copied.status) || "Copy ID";
              return (
                // The whole row opens the session; the open one stays highlighted.
                <tr
                  key={id}
                  className={
                    [session === id && "open-row", opens && "clickable-row"]
                      .filter(Boolean)
                      .join(" ") || undefined
                  }
                  onClick={() => opens && openSession(id)}
                >
                  <td data-label="Session ID">
                    {/* One piece, so on a phone the ID and its button sit together beside the label. */}
                    <span className="id-cell">
                      <code className="session-id" title={id}>
                        {id.slice(0, 8)}…
                      </code>
                      <button
                        type="button"
                        className="copy-id"
                        onClick={(event) => {
                          // Copying should not also open the row it sits in.
                          event.stopPropagation();
                          copy(id);
                        }}
                        aria-label={`${copyLabel} for session ${id.slice(0, 8)}`}
                      >
                        {copyLabel}
                      </button>
                    </span>
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
                    {opens && (
                      <button
                        type="button"
                        className="open-link"
                        aria-haspopup="dialog"
                        aria-label={`Open session ${id.slice(0, 8)}`}
                        onClick={(event) => {
                          // The row would open it too; stopping here opens it once.
                          event.stopPropagation();
                          openSession(id);
                        }}
                      >
                        Open ›
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {/* An empty list says why: a search that matched nothing, or no sessions at all. */}
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
        noun="session"
      />

      {/* The pop-up for the open session. Keyed by ID, so opening another session starts it fresh
          instead of carrying over the last one's tab, filters and page. */}
      {session && (
        <SessionDetail
          key={session}
          id={session}
          onClose={() => openSession(null)}
        />
      )}
    </article>
  );
}
