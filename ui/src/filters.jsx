// The filter panel and the "Showing only:" chips: every tag and reason with its count, and
// one chip per filter in use so each can be removed in a click. Picks go up through onChange.
import React, { useEffect, useId, useRef, useState } from "react";
import { Info, number } from "./format";
import { errorText } from "./compare";

// An open filter section shows its biggest six until "+ N more" is clicked. Fewer than six
// is too few to scan, many more makes the panel long.
const SHOWN = 6;
// The sections most questions start from stay open; the rest fold under "More filters".
const MAIN_SECTIONS = ["Connection", "Kind of error", "Where it failed"];

// Under a heading that already says it, a filter drops the repeated start:
// "Error: video connection failed" under "Kind of error" reads "Video connection failed".
const REPEATED = {
  "Kind of error": /^Error: /,
  "Where it failed": /^Error in /,
  "How it ended": /^Ended: /,
};
function shortTitle(title, section) {
  const short = REPEATED[section]
    ? title.replace(REPEATED[section], "")
    : title;
  // Event names stay exactly as sent; only plain words get a capital.
  return /^[a-z]+\.[a-z]/.test(short)
    ? short
    : short[0].toUpperCase() + short.slice(1);
}

// The filter panel beside the cards. On narrow screens the filters fold away behind a button.
export function FilterPanel({ facets, filters, reason, onChange }) {
  const [showFilters, setShowFilters] = useState(false);
  return (
    <>
      {/* Only seen on narrow screens; it counts the filters in use while they are hidden. */}
      <button
        type="button"
        className="filters-toggle"
        aria-expanded={showFilters}
        onClick={() => setShowFilters((open) => !open)}
      >
        {showFilters ? "Hide filters" : "Filters"}
        {filters.length > 0 && ` (${filters.length})`}
      </button>
      <div className={"filters-wrap" + (showFilters ? " open" : "")}>
        <Filters
          facets={facets}
          filters={filters}
          reason={reason}
          onChange={onChange}
        />
      </div>
    </>
  );
}

// Filters with counts: every tag and reason, counted under the filters already chosen.
// Choosing more than one keeps only sessions that have all of them.
function Filters({ facets, filters, reason, onChange }) {
  // The "Find a filter" box narrows every section to rows containing its text.
  const [find, setFind] = useState("");
  const box = useRef(null);
  // Pressing / jumps to the find box, as on many sites, unless someone is typing
  // in another box or a dialog is open over the page.
  useEffect(() => {
    function jump(event) {
      const typing = ["INPUT", "SELECT", "TEXTAREA"].includes(
        document.activeElement?.tagName,
      );
      if (
        event.key === "/" &&
        !typing &&
        !document.querySelector("dialog[open]")
      ) {
        event.preventDefault();
        box.current?.focus();
      }
    }
    window.addEventListener("keydown", jump);
    return () => window.removeEventListener("keydown", jump);
  }, []);
  // Whether "More filters" is open.
  const [more, setMore] = useState(false);
  const moreId = useId();
  // A tag is added or taken away; the "How far it got" choice stays as it is.
  const toggle = (key) =>
    onChange(
      filters.includes(key)
        ? filters.filter((f) => f !== key)
        : [...filters, key],
      reason,
    );
  // The server's tag sections, then "How far it got". Every session has exactly one
  // reason, so only one can be picked; picking it again lets it go.
  const sections = [
    ...facets.sections.map((section) => ({
      title: section.title,
      items: section.tags.map((tag) => ({
        key: tag.key,
        text: shortTitle(tag.title, section.title),
        count: tag.count,
        on: filters.includes(tag.key),
        pick: () => toggle(tag.key),
      })),
    })),
    {
      title: "How far it got",
      items: facets.reasons.map(([text, count]) => ({
        key: text,
        text,
        count,
        on: reason === text,
        pick: () => onChange(filters, reason === text ? "" : text),
      })),
    },
  ];
  const wanted = find.trim().toLowerCase();
  // Each section with only the rows that match the search; one with no match disappears.
  const matching = sections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) =>
        item.text.toLowerCase().includes(wanted),
      ),
    }))
    .filter((section) => section.items.length);
  const main = matching.filter((s) => MAIN_SECTIONS.includes(s.title));
  const rest = matching.filter((s) => !MAIN_SECTIONS.includes(s.title));
  // How many picks sit under "More filters", so a folded pick is never missed.
  const active = rest.reduce(
    (sum, s) => sum + s.items.filter((item) => item.on).length,
    0,
  );
  // A pick inside "More filters" opens it, so the pick stays visible and unpicking it never
  // pulls the focused box away. Searching looks through every section, folded or not.
  useEffect(() => {
    if (active > 0) setMore(true);
  }, [active > 0]);
  const restShown = more || wanted ? rest : [];
  // While searching, the number of matching rows is read out after each change, and shown
  // when it is none, so a search that finds nothing never looks like an empty panel.
  const found = matching.reduce((sum, s) => sum + s.items.length, 0);
  const status = !wanted
    ? ""
    : found
      ? `${found} ${found === 1 ? "filter matches" : "filters match"}`
      : `No filters match "${find.trim()}".`;
  // "Clear" lets go of every pick in the panel. Its link then disappears, so the focus
  // moves to the find box instead of falling back to the top of the page.
  const picked = filters.length > 0 || Boolean(reason);
  function clear() {
    onChange([], "");
    box.current?.focus();
  }
  const draw = (section) => (
    <FacetSection
      key={section.title}
      title={section.title}
      items={section.items}
      searching={Boolean(wanted)}
    />
  );
  return (
    <aside className="panel filters" aria-label="Filter sessions">
      <div className="filters-head">
        <h2 className="filters-title">
          Filter sessions
          <Info topic="Filter sessions">
            Every filter, with how many sessions match it under the filters
            already chosen. Picking more than one keeps only sessions that have
            all of them.
          </Info>
        </h2>
        {picked && (
          <button
            type="button"
            className="link-button filters-clear"
            onClick={clear}
          >
            Clear
          </button>
        )}
      </div>
      <input
        ref={box}
        type="search"
        aria-label="Find a filter"
        placeholder="Find a filter (press /)"
        value={find}
        onChange={(event) => setFind(event.target.value)}
      />
      {/* Always in the page, so screen readers hear each new count; only "none" is seen. */}
      <p
        className={"facet-status" + (found ? " visually-hidden" : "")}
        role="status"
      >
        {status}
      </p>
      {main.map(draw)}
      {/* While searching every match is already shown, so there is nothing to unfold. */}
      {rest.length > 0 && !wanted && (
        <button
          type="button"
          className="facet-toggle"
          aria-expanded={more}
          aria-controls={moreId}
          onClick={() => setMore(!more)}
        >
          <span className="chevron" aria-hidden="true" />
          More filters
          {active > 0 && <span className="facet-active">{active} active</span>}
        </button>
      )}
      <div id={moreId}>{restShown.map(draw)}</div>
    </aside>
  );
}

// One filter section: a heading that folds it, then one checkbox per row, largest first as
// the server sends them, each with its count.
function FacetSection({ title, items, searching }) {
  // Whether the section is unfolded, and whether "+ N more" is on.
  const [open, setOpen] = useState(true);
  const [all, setAll] = useState(false);
  const bodyId = useId();
  const listId = useId();
  // Folded, the section shows its biggest few plus any picked row, so a pick never hides
  // and never moves. A button that would hide a single row takes that row's room, so then
  // every row shows.
  const top = items.filter((item, i) => i < SHOWN || item.on);
  const hidden = items.length - top.length;
  const fold = !searching && hidden > 1;
  const visible = fold && !all ? top : items;
  // A search shows its matches even in a folded section; a folded section with picks says
  // how many, so a pick is never out of sight without a trace.
  const shown = open || searching;
  const picks = items.filter((item) => item.on).length;
  return (
    <section className="facet-section">
      <h3>
        <button
          type="button"
          className="facet-head"
          aria-expanded={shown}
          aria-controls={bodyId}
          onClick={() => setOpen(!shown)}
        >
          <span className="chevron" aria-hidden="true" />
          {title}
          {!shown && picks > 0 && (
            <span className="facet-active">{picks} active</span>
          )}
        </button>
      </h3>
      <div id={bodyId} hidden={!shown}>
        <ul id={listId} className="facet-list">
          {visible.map((item) => (
            <li key={item.key}>
              {/* A real checkbox inside its label: the whole row toggles it, and screen
                  readers hear the name, the count and whether it is picked. Long names
                  end in "…" and show in full on hover. */}
              <label className="facet-option" title={item.text}>
                <input type="checkbox" checked={item.on} onChange={item.pick} />
                <span className="facet-label">{item.text}</span>
                <span className="count">
                  {number(item.count)}
                  <span className="visually-hidden"> sessions</span>
                </span>
              </label>
            </li>
          ))}
        </ul>
        {fold && (
          <button
            type="button"
            className="facet-more"
            aria-expanded={all}
            aria-controls={listId}
            onClick={() => setAll(!all)}
          >
            {all ? "Show less" : `+ ${hidden} more`}
          </button>
        )}
      </div>
    </section>
  );
}

// The "Showing only:" row above the cards: one chip per filter in use, each removing
// itself when clicked, and "Clear all". Hidden when nothing is filtered.
// The chips name the filters the numbers below were counted under (`shown`), which lag the
// panel while new numbers load; removing one takes it from the current choices, so a pick
// made meanwhile is kept.
export function ActiveFilters({ shown, current, titles, sections, onChange }) {
  const { filters, reason, error } = shown;
  // Where the focus goes once a removed chip is gone: the chip that takes its place (or the
  // last one left), else the find box, else the narrow-screen Filters button, instead of
  // falling back to the top of the page. The chip only goes once the new numbers arrive,
  // so until then the focus stays on it.
  const row = useRef(null);
  const removed = useRef(null);
  // Each tag's section title, so a chip can say where its filter came from.
  const sectionOf = Object.fromEntries(
    sections.flatMap((section) =>
      section.tags.map((tag) => [tag.key, section.title]),
    ),
  );
  // Each chip's label names exactly what it shows: "Remove filter <its text>".
  const chips = filters.map((key) => ({
    key,
    text:
      (sectionOf[key] ? sectionOf[key] + ": " : "") +
      shortTitle(titles[key] || key, sectionOf[key]),
    remove: () =>
      onChange(
        current.filters.filter((f) => f !== key),
        current.reason,
      ),
  }));
  if (reason)
    chips.push({
      key: "reason",
      text: "How far it got: " + reason,
      remove: () => onChange(current.filters, ""),
    });
  if (error)
    chips.push({
      key: "error",
      text: errorText(error),
      remove: () => onChange(current.filters, current.reason, null),
    });
  const keys = chips.map((chip) => chip.key).join(" ");
  useEffect(() => {
    if (!removed.current || keys.split(" ").includes(removed.current.key))
      return;
    const left = row.current?.querySelectorAll(".chip-button") || [];
    const search = document.querySelector(".filters input[type='search']");
    const next =
      left[Math.min(removed.current.index, left.length - 1)] ||
      (search?.offsetParent ? search : null) ||
      document.querySelector(".filters-toggle");
    removed.current = null;
    next?.focus();
  }, [keys]);
  if (!chips.length) return null;
  return (
    <div
      ref={row}
      className="active-filters"
      role="group"
      aria-label="Active filters"
    >
      <strong>Showing only:</strong>
      {chips.map((chip, index) => (
        <button
          type="button"
          key={chip.key}
          className="chip-button"
          onClick={() => {
            removed.current = { key: chip.key, index };
            chip.remove();
          }}
          aria-label={`Remove filter ${chip.text}`}
        >
          {chip.text} ✕
        </button>
      ))}
      <button
        type="button"
        className="link-button"
        onClick={() => onChange([], "", null)}
      >
        Clear all
      </button>
    </div>
  );
}
