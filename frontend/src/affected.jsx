import React, { useEffect, useRef, useState } from "react";
import { Info, Pages, number, utcTime } from "./format";
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
  "Below 30 FPS": "Minutes where FPS was under 30.",
  Attempts: "How many times the app tried to connect.",
  "Stream drops": "Times the video connection was lost while playing.",
  "Skipped-frame time": "Minutes with 10 or more skipped frames in a second.",
  "Wait until video":
    "Time from connecting to the first video frame, for the first successful connect.",
  Why: "Our plain-words summary of how far the session got. Open the details for the app's own message.",
};

const COLUMNS = {
  "First event": (row) => utcTime(row.first_seen),
  Streamed: (row) => minutes(row, "streamed_seconds"),
  "Avg FPS": (row) => number(row.fps_mean, 1),
  "Below 30 FPS": (row) => minutes(row, "low_fps_seconds"),
  Attempts: (row) => number(row.attempts),
  "Stream drops": (row) => number(row.stream_drops),
  "Skipped-frame time": (row) => minutes(row, "high_skip_seconds"),
  "Wait until video": (row) =>
    row.first_ready_ms == null
      ? "—"
      : number(row.first_ready_ms / 1000, 1) + " s",
  Why: (row) => row.why,
};

function columnsFor(category) {
  if (category === "all") return Object.keys(COLUMNS);
  if (category === "stream_drops")
    return ["First event", "Streamed", "Stream drops", "Why"];
  if (category === "high_skip")
    return ["First event", "Streamed", "Avg FPS", "Skipped-frame time"];
  if (category === "ready")
    return ["First event", "Wait until video", "Attempts", "Why"];
  if (QUALITY.has(category))
    return ["First event", "Streamed", "Avg FPS", "Below 30 FPS"];
  return ["First event", "Attempts", "Why"];
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
}) {
  const [session, setSession] = useState(null);
  const [copied, setCopied] = useState(null);
  const panel = useRef(null);
  const columns = columnsFor(category);

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

  // The list opens below the cards, so bring it into view when a card is clicked.
  useEffect(() => {
    panel.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  return (
    <article className="panel" ref={panel}>
      <h3>
        {group.title}: {number(group.count)}
      </h3>
      <p>{group.definition}</p>

      {/* Where these sessions stopped, counted over the whole list, not just this page. */}
      {!QUALITY.has(category) && (
        <ul className="reasons">
          {sessions.reasons.map(([reason, count]) => (
            <li key={reason}>
              <strong>{number(count)}</strong> {reason}
            </li>
          ))}
        </ul>
      )}

      <form
        className="session-filters"
        onSubmit={(event) => {
          event.preventDefault();
          const text = new FormData(event.currentTarget).get("search");
          onSearch(text.trim().toLowerCase());
        }}
      >
        <label>
          Session ID
          <input
            name="search"
            maxLength={36}
            defaultValue={search}
            placeholder="Full ID or part of one"
          />
        </label>
        <button>Search</button>
      </form>

      <p>{sessions.order}</p>
      <div className="table-scroll">
        <table aria-label={group.title}>
          <thead>
            <tr>
              {["Session ID", ...columns, ""].map((label) => (
                <th key={label} scope="col">
                  {label}
                  {NOTES[label] && <Info>{NOTES[label]}</Info>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sessions.items.map((row) => (
              <tr
                key={row.session_id}
                className={session === row.session_id ? "open-row" : ""}
              >
                <td data-label="Session ID">
                  <code className="session-id">{row.session_id}</code>
                  <button
                    className="copy-id"
                    onClick={() => copy(row.session_id)}
                    aria-label="Copy session ID"
                  >
                    {copied === row.session_id ? "Copied" : "Copy"}
                  </button>
                </td>
                {columns.map((label) => (
                  <td key={label} data-label={label}>
                    {COLUMNS[label](row)}
                  </td>
                ))}
                <td data-label="">
                  <button
                    className="primary-action"
                    aria-pressed={session === row.session_id}
                    onClick={() => setSession(row.session_id)}
                  >
                    View details
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!sessions.items.length && <p>No matching sessions.</p>}
      <Pages data={sessions} page={page} onChange={onPage} />

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
