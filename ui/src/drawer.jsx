// The drawer that slides in from the right with the sessions behind a card, opened as a
// modal dialog so Esc, Close and a click outside all close it the same way.
import React, { useEffect, useRef } from "react";
import { clickedOutside } from "./format";

// The sessions behind a card slide in from the right, over the page, so nothing scrolls away.
export function Drawer({ title, onClose, children }) {
  const dialog = useRef(null);
  // Opening moves focus to the drawer itself rather than its first button, so nothing is
  // outlined before it is used; Tab then starts at Close.
  useEffect(() => {
    dialog.current?.showModal();
    dialog.current?.focus();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="drawer"
      aria-label={title}
      tabIndex={-1}
      // Esc, Close and a click outside all close the dialog itself, so onClose
      // runs the same way for each. The session pop-up inside the drawer sends its own
      // close event up through React, so only this dialog's own close closes the drawer.
      onClose={(event) => {
        if (event.target === dialog.current) onClose();
      }}
      onClick={(event) => {
        if (clickedOutside(event)) dialog.current.close();
      }}
    >
      <button
        type="button"
        className="close-button"
        onClick={() => dialog.current.close()}
      >
        Close
      </button>
      {children}
    </dialog>
  );
}
