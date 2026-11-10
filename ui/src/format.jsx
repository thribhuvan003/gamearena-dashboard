// Small pieces every screen uses: number and time formatting, the "i" explanation button,
// notices, paging, and closing a pop-up when clicking outside it.
import React, { useState } from "react";

export function number(value, digits = 0) {
  return value == null
    ? "—"
    : Number(value).toLocaleString("en-IN", { maximumFractionDigits: digits });
}

// A count with its noun, singular for one: "1 session", "2 sessions".
export const plural = (n, word, words = word + "s") =>
  `${number(n)} ${n === 1 ? word : words}`;

// The database works in UTC days, so dates and times show in UTC everywhere.
export function dateLabel(day) {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function utcTime(value, withSeconds = false) {
  return value
    ? new Date(value).toLocaleString("en-GB", {
        timeZone: "UTC",
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        ...(withSeconds ? { second: "2-digit" } : {}),
      })
    : "—";
}

// A small round "i" button. Clicking it shows what a number means and how it is worked out.
export function Info({ children, topic }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="info">
      <button
        type="button"
        className="info-button"
        aria-label={topic ? `What is "${topic}"?` : "What does this mean?"}
        aria-expanded={open}
        onClick={(event) => {
          event.stopPropagation();
          setOpen(!open);
        }}
      >
        i
      </button>
      {open && (
        <span className="info-text" role="note">
          {children}
        </span>
      )}
    </span>
  );
}

// True when a click on a modal dialog landed on its backdrop. Clicks on the dialog's own
// padding also target the dialog, so the click's position decides, not its target.
export function clickedOutside(event) {
  if (event.target !== event.currentTarget) return false;
  const box = event.currentTarget.getBoundingClientRect();
  return (
    event.clientX < box.left ||
    event.clientX > box.right ||
    event.clientY < box.top ||
    event.clientY > box.bottom
  );
}

// Error or loading message for a request.
export function Notice({ error, loading, children }) {
  if (error)
    return (
      <p className="notice error" role="alert">
        {error}
      </p>
    );
  if (loading)
    return (
      <p className="notice" role="status">
        {children || "Loading…"}
      </p>
    );
  return null;
}

// noun is singular; nouns is only needed when adding an "s" doesn't make the plural.
export function Pages({ data, page, onChange, busy, noun = "row", nouns }) {
  if (!data) return null;
  return (
    <div className="pager">
      <button
        type="button"
        disabled={busy || page === 1}
        onClick={() => onChange(page - 1)}
      >
        Previous
      </button>
      <span role="status">
        Page {page} of{" "}
        {number(Math.max(1, Math.ceil(data.total / data.page_size)))} ·{" "}
        {plural(data.total, noun, nouns)}
      </span>
      <button
        type="button"
        disabled={busy || page * data.page_size >= data.total}
        onClick={() => onChange(page + 1)}
      >
        Next
      </button>
    </div>
  );
}
