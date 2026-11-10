import React, { useEffect, useRef, useState } from "react";

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
