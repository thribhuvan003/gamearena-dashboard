import React, { useRef, useState } from "react";

const LABELS = ["Copy link", "Link copied", "Couldn't copy"];

// Copies the page's address. The address already holds the dates, filters and open list,
// so whoever opens the link sees the same view.
export function CopyLinkButton() {
  const [status, setStatus] = useState("");
  const timer = useRef(null);

  // The result shows for two seconds, then the button reads "Copy link" again.
  function show(text) {
    setStatus(text);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setStatus(""), 2000);
  }

  // Started inside a promise so a browser without clipboard access lands on "Couldn't copy".
  function copy() {
    Promise.resolve()
      .then(() => navigator.clipboard.writeText(window.location.href))
      .then(
        () => show("Link copied"),
        () => show("Couldn't copy"),
      );
  }

  const shown = status || LABELS[0];
  return (
    <>
      <button type="button" className="copy-link" onClick={copy}>
        {/* Every label sits in the same place, so the button keeps its width as the text changes. */}
        {LABELS.map((label) => (
          <span key={label} aria-hidden={label !== shown}>
            {label}
          </span>
        ))}
      </button>
      {/* Screen readers hear the result without leaving the button. */}
      <span className="copy-link-status" role="status" aria-live="polite">
        {status}
      </span>
    </>
  );
}
