// The errors box in the session pop-up: every distinct error once, with how often it came
// and what the app sent, so many copies of one error still read in a single line.
import React from "react";
import { Info, number } from "./format";
import { Told } from "./session-events";
import { WHO_SENT, clock, eventName, plain } from "./session-words";

// Every distinct error in the session, most frequent first, with what the app sent.
export function SessionErrors({ errors, onShow }) {
  if (!errors.length)
    return (
      <p className="session-errors none">
        No errors were reported in this session.
      </p>
    );
  const { day, time } = clock(errors.flatMap((e) => [e.first_at, e.last_at]));
  return (
    <section className="session-errors" aria-label="Errors in this session">
      <header>
        <h3>
          Errors in this session
          <Info topic="Errors in this session">
            Every event the app marked as an error, grouped when the event,
            code, stage, phase and text are the same. The text in quotes is
            exactly what the app sent. Times are UTC.
          </Info>
        </h3>
        <button type="button" className="link-button" onClick={onShow}>
          Show them in the list
        </button>
      </header>
      {day && <small>All on {day} (UTC).</small>}
      <ul>
        {errors.map((e, index) => (
          <li key={index}>
            <span className="error-count">{number(e.events)}×</span>
            <div>
              <strong>{eventName(e)}</strong>
              {/* Errors logged after the server closed the session are marked: they could not have ended it. */}
              {e.after_end && (
                <span className="chip">after the session ended</span>
              )}
              <Told fact={e} />
              {/* One time if every copy came at once, otherwise the first and last time. */}
              <small>
                {e.first_at === e.last_at
                  ? time(e.first_at)
                  : `${time(e.first_at)} → ${time(e.last_at)}`}{" "}
                · sent by {plain(e.source, WHO_SENT)}
              </small>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
