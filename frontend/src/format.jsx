import React from "react";

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

export function utcTime(value) {
  return value
    ? new Date(value).toLocaleString("en-GB", { timeZone: "UTC" })
    : "—";
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

export function Pages({ data, page, onChange, busy }) {
  if (!data) return null;
  return (
    <div className="preset-buttons">
      <button disabled={busy || page === 1} onClick={() => onChange(page - 1)}>
        Previous
      </button>
      <span role="status">
        Page {page} · {number(data.total)} rows
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
