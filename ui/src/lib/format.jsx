// Small pieces every screen uses: number and time formatting, the "i" explanation button,
// notices, paging, and closing a pop-up when clicking outside it.
import React, { useEffect, useId, useRef, useState } from "react";

// A number grouped the Indian way (12,34,567) with at most `digits` decimals.
// A missing value shows as a dash, so a gap never reads as zero.
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

// A moment as date and time in UTC, to match the dates. Seconds only when asked for,
// where events close together need telling apart. No value shows as a dash.
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
// Esc closes it again; inside the drawer or a pop-up, that Esc closes only the explanation.
export function Info({ children, topic }) {
  const [open, setOpen] = useState(false);
  // Ties the button to the explanation it shows, for screen readers.
  const id = useId();
  useEffect(() => {
    if (!open) return;
    function close(event) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
    }
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [open]);
  return (
    <span className="info">
      <button
        type="button"
        className="info-button"
        aria-label={topic ? `What is "${topic}"?` : "What does this mean?"}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={(event) => {
          // An "i" can sit inside something that reacts to clicks itself; the click
          // stops here so it only opens the explanation.
          event.stopPropagation();
          setOpen(!open);
        }}
      >
        i
      </button>
      {open && (
        <span className="info-text" role="note" id={id}>
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

// Error or loading message for a request. The error wins, so a failed request never
// looks as if it is still loading; with neither, nothing shows.
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

// Previous and Next under a list, with "Page 2 of 5 · 93 rows" between them.
// Both buttons are off while a page is loading, so clicks can't pile up.
// noun is singular; nouns is only needed when adding an "s" doesn't make the plural.
export function Pages({ data, page, onChange, busy, noun = "row", nouns }) {
  if (!data) return null;
  // The last page there is, never past the server's page limit when it sets one.
  const pages = Math.max(1, Math.ceil(data.total / data.page_size));
  const last = data.max_pages ? Math.min(pages, data.max_pages) : pages;
  return (
    <div className="pager">
      <button
        type="button"
        disabled={busy || page === 1}
        onClick={() => onChange(page - 1)}
      >
        Previous
      </button>
      {/* An empty list still reads "Page 1 of 1". */}
      <span role="status">
        Page {page} of {number(last)} · {plural(data.total, noun, nouns)}
      </span>
      <button
        type="button"
        disabled={busy || page >= last}
        onClick={() => onChange(page + 1)}
      >
        Next
      </button>
    </div>
  );
}

// Copies text and reports how it went for two seconds: "Copied" or "Couldn't copy".
// `key` names what was copied, so a list can show the result on the right row.
// Returns [{ key, status }, copy]; status is "" when there is nothing to report.
export function useCopy() {
  const [result, setResult] = useState({ key: null, status: "" });
  const timer = useRef(null);
  // A pending reset is cancelled if the button goes away, so it never updates a gone component.
  useEffect(() => () => clearTimeout(timer.current), []);

  // Shows a result, then clears it after two seconds. A second copy restarts the clock.
  function show(key, status) {
    setResult({ key, status });
    clearTimeout(timer.current);
    timer.current = setTimeout(
      () => setResult({ key: null, status: "" }),
      2000,
    );
  }

  // Started inside a promise so a browser without clipboard access lands on "Couldn't copy".
  function copy(text, key = text) {
    Promise.resolve()
      .then(() => navigator.clipboard.writeText(text))
      .then(
        () => show(key, "Copied"),
        () => show(key, "Couldn't copy"),
      );
  }

  return [result, copy];
}

// Everything the button can say; the first is what it says when nothing has happened.
const LABELS = ["Copy link", "Copied", "Couldn't copy"];

// Copies the page's address. The address already holds the dates, filters and open list,
// so whoever opens the link sees the same view.
export function CopyLinkButton() {
  const [{ status }, copy] = useCopy();
  const shown = status || LABELS[0];
  return (
    <>
      <button
        type="button"
        className="copy-link"
        onClick={() => copy(window.location.href)}
      >
        {/* Every label sits in the same place, so the button keeps its width as the text changes. */}
        {LABELS.map((label) => (
          <span key={label} aria-hidden={label !== shown}>
            {label}
          </span>
        ))}
      </button>
      {/* Screen readers hear the result without leaving the button. */}
      <span className="visually-hidden" role="status">
        {status}
      </span>
    </>
  );
}
