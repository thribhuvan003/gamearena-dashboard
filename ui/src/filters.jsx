// The filter panel and the "Showing only:" chips: every tag and reason with its count, and
// one chip per filter in use so each can be removed in a click. Picks go up through onChange.
import React, { useEffect, useId, useRef, useState } from "react";
import { Info, number } from "./format";
import { errorText } from "./compare";

// An open filter section shows its biggest six until "Show N more" is clicked. Fewer than six
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
  // pulls the focused button away. Searching looks through every section, folded or not.
  useEffect(() => {
    if (active > 0) setMore(true);
  }, [active > 0]);
  const restShown = more || wanted ? rest : [];
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
      <h2 className="filters-title">
        Filter sessions
        <Info topic="Filter sessions">
          Every filter, with how many sessions match it under the filters
          already chosen. Picking more than one keeps only sessions that have
          all of them.
        </Info>
      </h2>
      <input
        ref={box}
        type="search"
        aria-label="Find a filter"
        placeholder="Find a filter (press /)"
        value={find}
        onChange={(event) => setFind(event.target.value)}
      />
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
          More filters
          {active > 0 && <span className="facet-active">{active} active</span>}
        </button>
      )}
      <div id={moreId}>{restShown.map(draw)}</div>
    </aside>
  );
}

// One filter section: its rows, largest first as the server sends them, each with its count
// and a faint bar for its share of the section's largest.
function FacetSection({ title, items, searching }) {
  // Whether "Show N more" is on.
  const [all, setAll] = useState(false);
  const listId = useId();
  // Folded, the section shows its biggest few plus any picked row, so a pick never hides
  // and never moves. A button that would hide a single row takes that row's room, so then
  // every row shows.
  const top = items.filter((item, i) => i < SHOWN || item.on);
  const hidden = items.length - top.length;
  const fold = !searching && hidden > 1;
  const visible = fold && !all ? top : items;
  const largest = Math.max(1, ...items.map((item) => item.count));
  return (
    <section className="facet-section">
      <h3>{title}</h3>
      <ul id={listId} className="facet-list">
        {visible.map((item) => (
          <li key={item.key}>
            <button
              type="button"
              aria-pressed={item.on}
              onClick={item.pick}
              style={{ "--share": item.count / largest }}
            >
              <span className="facet-label">
                <span className="tick" aria-hidden="true">
                  {item.on ? "✓" : ""}
                </span>
                <span>{item.text}</span>
              </span>
              <span className="count">{number(item.count)}</span>
            </button>
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
          {all ? "Show fewer" : `Show ${hidden} more`}
        </button>
      )}
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
  if (!chips.length) return null;
  return (
    <div className="active-filters" role="group" aria-label="Active filters">
      <strong>Showing only:</strong>
      {chips.map((chip) => (
        <button
          type="button"
          key={chip.key}
          className="chip-button"
          onClick={chip.remove}
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
