// The session pop-up: the errors in the session, its numbers, the event timeline and stream
// quality. Raw event names and payloads sit behind the Technical details switch.
import React, { useEffect, useRef, useState } from "react";
import { useReport } from "./api";
import { Notice, Pages, clickedOutside, number, utcTime } from "./format";
import { EventFilters, EventTable } from "./session-events";
import { StreamQuality } from "./session-quality";
import { SessionSummary } from "./session-summary";
import { DataTable } from "./session-table";
import { CONNECTION_NOTES, ROLES, WHO_SENT, plain } from "./session-words";
import { useCopy } from "./share";

// Where this browser remembers whether Technical details is on.
const TECHNICAL_KEY = "gamearena.technical";
// The sections under the summary, as [name used in the code, label]. Connections only shows
// with technical details on.
const TABS = [
  ["events", "What happened"],
  ["performance", "Stream quality"],
  ["connections", "Connections"],
];

// One session from our own telemetry: summary, then events, performance and connections.
export function SessionDetail({ id, onClose }) {
  // Engineers switch this on once; the choice is remembered on this computer.
  const [technical, setTechnical] = useState(() => {
    try {
      return localStorage.getItem(TECHNICAL_KEY) === "1";
    } catch {
      return false;
    }
  });
  function showTechnical(on) {
    setTechnical(on);
    // The Connections tab only exists with technical details, so switching off leaves it.
    if (!on)
      setTab((current) => (current === "connections" ? "events" : current));
    try {
      localStorage.setItem(TECHNICAL_KEY, on ? "1" : "0");
    } catch {
      // Private windows can block storage; the switch still works for this visit.
    }
  }
  // "Copied" or "Couldn't copy" shows on the Copy ID button for a moment.
  const [{ status: copied }, copy] = useCopy();
  // The open section, the event filters and the page of the paged list. Changing the section
  // or a filter always goes back to page 1, since the old page number may no longer exist.
  const [tab, setTab] = useState("events");
  const [filters, setFilters] = useState({});
  const [page, setPage] = useState(1);
  // The section switches, so a tile can scroll the list into view.
  const tabs = useRef(null);

  // Always the whole session, whatever dates the page has selected.
  const result = useReport("sessions/" + id, {});
  const detail = result.data;
  const row = detail?.session;
  // Only the event list and the 10-second groups load a page at a time. Connections come with
  // the summary. The 10-second groups only show with technical details, so they load only then,
  // and a session without stats has no groups to load. No name means nothing is fetched.
  const pagedName = {
    events: "sessions/" + id + "/events",
    performance:
      row?.batches && technical ? "sessions/" + id + "/buckets" : null,
  }[tab];
  const list = useReport(pagedName, { ...filters, page });
  const dialog = useRef(null);

  // Opens as a pop-up over the list as soon as it appears, and puts focus on its title so
  // keyboard and screen reader users start at the top. Esc, the Close button or a click outside
  // closes it, and closing tells the list through onClose.
  useEffect(() => {
    dialog.current?.showModal();
    dialog.current?.querySelector("h2")?.focus();
  }, []);

  // Used by the errors box and the Warnings tile: switch to the event list, filtered to that
  // level (or not filtered), from the first page, and scroll down to it.
  function showEvents(level) {
    setTab("events");
    setFilters(level ? { level } : {});
    setPage(1);
    tabs.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // The selects show the filters held here, so a tile that sets a filter updates them too.
  function filterEvents(event) {
    setFilters({ ...filters, [event.target.name]: event.target.value });
    setPage(1);
  }

  // A click on the dimmed backdrop is reported as a click on the dialog itself, so
  // clickedOutside checks whether it landed outside the box before closing.
  return (
    <dialog
      ref={dialog}
      className="panel session-detail"
      aria-label="Session details"
      onClose={onClose}
      onClick={(event) => {
        if (clickedOutside(event)) dialog.current.close();
      }}
    >
      <header className="detail-head">
        {/* The title shows the ID's first 8 characters; hovering shows it in full and Copy ID copies all of it. */}
        <h2 tabIndex={-1} className="panel-title">
          Session{" "}
          <code className="session-id" title={id}>
            {id.slice(0, 8)}…
          </code>
        </h2>
        <button type="button" className="copy-id" onClick={() => copy(id)}>
          {copied || "Copy ID"}
        </button>
        {/* Off by default. On, it adds the app's raw event names and messages, the connections and the 10-second stream table. */}
        <label className="switch">
          <input
            type="checkbox"
            checked={technical}
            onChange={(event) => showTechnical(event.target.checked)}
          />
          Technical details
        </label>
        <button
          type="button"
          className="close-button"
          onClick={() => dialog.current.close()}
        >
          Close
        </button>
      </header>
      {/* Loading or error message for the session summary; everything below waits for it. */}
      <Notice {...result} />

      {detail && (
        <>
          <SessionSummary
            detail={detail}
            technical={technical}
            showEvents={showEvents}
          />

          {/* Section switches. Picking one starts its list from the first page. */}
          <div
            className="tabs"
            role="group"
            aria-label="Session sections"
            ref={tabs}
          >
            {TABS.filter(([name]) => technical || name !== "connections").map(
              ([name, label]) => (
                <button
                  type="button"
                  key={name}
                  aria-pressed={tab === name}
                  onClick={() => {
                    setTab(name);
                    setPage(1);
                  }}
                >
                  {label}
                </button>
              ),
            )}
          </div>

          {tab === "events" && (
            <>
              <EventFilters
                filters={filters}
                filterEvents={filterEvents}
                connections={detail.connections}
                technical={technical}
              />
              {/* Loading or error message for this page of events, then the events once they arrive. */}
              <Notice {...list} />
              {list.data && (
                <EventTable items={list.data.items} technical={technical} />
              )}
            </>
          )}

          {/* One row per connection, from the summary already loaded. Also checks technical, in case
              the tab was open when the switch went off. */}
          {tab === "connections" && technical && (
            <DataTable
              label="Session connections"
              notes={CONNECTION_NOTES}
              columns={[
                "Connection",
                "Role",
                "Sent by",
                "First event",
                "Last event",
                "Attempts",
                "Connected",
                "Connection errors",
                "Disconnects",
                "Reconnects",
              ]}
              rows={detail.connections.map((c) => [
                c.connection_id || "Not tied to a connection",
                plain(c.roles, ROLES),
                plain(c.sources, WHO_SENT),
                utcTime(c.first_seen),
                utcTime(c.last_seen),
                number(c.attempts),
                number(c.successes),
                number(c.failures),
                number(c.disconnects),
                number(c.reconnects),
              ])}
            />
          )}

          {tab === "performance" && (
            <StreamQuality
              batches={row.batches}
              metrics={detail.metrics}
              technical={technical}
              list={list}
            />
          )}

          {/* Page buttons only for the lists that load a page at a time, named for what they page through. */}
          {pagedName && (
            <Pages
              data={list.data}
              page={page}
              onChange={setPage}
              busy={list.loading}
              noun={tab === "events" ? "event" : "group of 10 readings"}
              nouns={tab === "events" ? "events" : "groups of 10 readings"}
            />
          )}
        </>
      )}
    </dialog>
  );
}
