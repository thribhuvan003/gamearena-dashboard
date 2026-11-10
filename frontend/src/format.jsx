import React, { useState } from "react";

export function number(value, digits = 0) {
  return value == null
    ? "—"
    : Number(value).toLocaleString("en-IN", { maximumFractionDigits: digits });
}

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

export function Pages({ data, page, onChange, busy, noun = "rows" }) {
  if (!data) return null;
  return (
    <div className="preset-buttons">
      <button disabled={busy || page === 1} onClick={() => onChange(page - 1)}>
        Previous
      </button>
      <span role="status">
        Page {page} of{" "}
        {number(Math.max(1, Math.ceil(data.total / data.page_size)))} ·{" "}
        {number(data.total)} {noun}
      </span>
      <button
        disabled={busy || page * data.page_size >= data.total}
        onClick={() => onChange(page + 1)}
      >
        Next
      </button>
    </div>
  );
}
