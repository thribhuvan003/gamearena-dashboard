// The top of the session pop-up: how far the session got, its errors, the key numbers and
// the stream verdict, with the rest of the numbers folded under More numbers.
import React from "react";
import { Info, number, utcTime } from "./format";
import { SessionErrors } from "./session-errors";
import { verdict } from "./session-quality";
import { Tile } from "./session-table";
import { ENDINGS, WHO, plain } from "./session-words";

// The session's length for the Duration tile. With no end recorded the server measures to the
// last event, so the tile says the real length could be longer.
function duration(row) {
  if (row.duration_seconds == null) return "—";
  const minutes = number(row.duration_seconds / 60, 1) + " min";
  return row.duration_is_minimum
    ? `At least ${minutes} (no end recorded)`
    : minutes;
}

// `showEvents` switches the pop-up to the event list, filtered to one level.
export function SessionSummary({ detail, technical, showEvents }) {
  const row = detail.session;
  return (
    <>
      {/* The outcome the pipeline stored for this session ("Not worked out yet" until it has
          processed it), then how the server says it ended. */}
      <p className="detail-story">
        <strong>{row.why || "Not worked out yet"}</strong>
        {row.end_reason &&
          ` · Ended: ${ENDINGS[row.end_reason] || row.end_reason}`}
        <Info topic="How far it got">
          How far this session got, in plain words, and why the server closed
          it. &quot;Gaming server removed&quot; means the cloud gaming server
          was taken away, by the provider or during a test, so it is not an
          error in the session.
        </Info>
      </p>
      <SessionErrors
        errors={detail.errors}
        onShow={() => showEvents("error")}
      />
      {/* The three numbers that matter most. Time to video only shows if video ever started. */}
      <div className="metric-grid">
        {row.first_ready_ms != null && (
          <Tile
            label="Time to video"
            info="Time from connecting to the first video frame, for the first successful connect."
            value={number(row.first_ready_ms / 1000, 1) + "\u00a0s"}
          />
        )}
        <Tile
          label="Duration"
          value={duration(row)}
          info="End minus start. With no end recorded, it runs to the last event, so it is a minimum."
        />
        <Tile
          label="Attempts"
          value={number(row.attempts)}
          info="How many times the app tried to connect."
        />
      </div>
      <p className="verdict">{verdict(detail.metrics, row.batches)}</p>
      {/* The rest of the numbers fold away, so the story and the key numbers stay short. */}
      <details>
        <summary>More numbers</summary>
        <div className="metric-grid">
          <Tile
            label="Started"
            value={utcTime(row.started_at)}
            info="When the server logged the session start (UTC)."
          />
          <Tile
            label="Ended"
            value={row.ended_at ? utcTime(row.ended_at) : "No end recorded"}
            info="When the server logged the session end (UTC)."
          />
          <Tile
            label="Who joined"
            info="How players joined: as the owner, through a share link, or as an external user."
            value={plain(row.access_modes, WHO)}
          />
          <Tile
            label="Player joins"
            value={number(row.client_connections)}
            info="How many times a player joined. Someone who leaves and comes back counts again, so this counts joins, not people."
          />
          <Tile
            label="Lost video while playing"
            value={number(row.stream_drops)}
            info="Times the video connection went from connected to lost while playing."
          />
          <Tile
            label="Players who left"
            value={number(row.disconnects)}
            info="Times a player left."
          />
          <Tile
            label="Players who came back"
            value={number(row.reconnects)}
            info="Times a player came back."
          />
          <Tile
            label="Warnings"
            value={number(row.warnings)}
            onOpen={row.warnings ? () => showEvents("warn") : null}
            info="Events marked as warnings: something went wrong but may have recovered. Click the number to see them."
          />
        </div>
      </details>
      {/* For engineers: the tags the pipeline stored, which decide which cards count this session. */}
      {technical && (
        <p className="technical-note">
          Appears in: {row.tags.join(" · ") || "—"}
        </p>
      )}
    </>
  );
}
