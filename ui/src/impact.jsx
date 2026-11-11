// The main page: headline sentence, headline cards with trend lines, the two charts, the
// detail sections, the error table, the filter panel, and the drawer with a card's sessions.
// This file keeps what the page shows in step with the address bar and loads the numbers;
// each part it draws lives in its own file.
import React, { useEffect, useRef, useState } from "react";
import { useReport } from "./api";
import { AffectedSessions } from "./affected";
import { Notice } from "./format";
import { readUrl, writeUrl } from "./url";
import { listKey } from "./choices";
import {
  datesText,
  errorFrom,
  errorParams,
  errorText,
  versusWords,
} from "./compare";
import { ActiveFilters, FilterPanel } from "./filters";
import { Headline, HeadlineCards } from "./cards";
import { Charts } from "./charts-section";
import { DetailSections } from "./details";
import { ErrorReasons } from "./errors-table";
import { Drawer } from "./drawer";

// No column picked: the session list keeps the order the server gives it.
const NO_SORT = { key: "", order: "desc" };

// Everything under the date picker for the chosen dates. The open card, filters and picked
// error start from the address bar, so a shared link opens the same view.
export function DailyImpact({ period, revision, dataStart }) {
  const fromUrl = readUrl();
  // The group whose sessions are open in the drawer, or null when it is closed.
  const [category, setCategory] = useState(fromUrl.card || null);
  // Page, search and sort of the session list in the drawer.
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState(NO_SORT);
  // The title of the card that opened the list, which the drawer mentions.
  const [from, setFrom] = useState(null);
  // What the whole page is narrowed to: tags, one "how far it got" reason, one error.
  const [filters, setFilters] = useState(
    fromUrl.filters ? fromUrl.filters.split(",") : [],
  );
  const [reason, setReason] = useState(fromUrl.reason || "");
  const [error, setError] = useState(errorFrom(fromUrl));
  // The last numbers that arrived, with the dates and filters they were counted for, kept on
  // screen while new ones load or after a request fails.
  const [shown, setShown] = useState(null);
  // Goes up on "Try again", which asks for the same numbers once more.
  const [retry, setRetry] = useState(0);

  // A new list starts from the first page, with no search or sort.
  function firstPage() {
    setPage(1);
    setSearch("");
    setSort(NO_SORT);
  }

  // A new date starts from the first page with no search or sort.
  useEffect(firstPage, [period]);

  // Keep the address bar in step with the page, and follow it on Back and Forward.
  useEffect(() => {
    writeUrl({
      card: category,
      filters: filters.join(","),
      reason,
      ...errorParams(error),
      // Closing the list also closes any session opened from it.
      ...(category ? {} : { session: "" }),
    });
  }, [category, filters, reason, error]);
  // Which list is open, in the address bar's terms, so Back can tell whether it changed.
  const openList = useRef("");
  openList.current = listKey({
    card: category,
    filters: filters.join(","),
    reason,
    ...errorParams(error),
  });
  useEffect(() => {
    function follow() {
      const url = readUrl();
      // A step that only opened or closed a session pop-up leaves the list as it was, on the
      // same page with the same search and sort. New dates start the list afresh on their own.
      if (listKey(url) === openList.current) return;
      setCategory(url.card || null);
      setFilters(url.filters ? url.filters.split(",") : []);
      setReason(url.reason || "");
      setError(errorFrom(url));
      // The card a list came from isn't in the address, so it is forgotten.
      setFrom(null);
      firstPage();
    }
    window.addEventListener("popstate", follow);
    return () => window.removeEventListener("popstate", follow);
  }, []);

  // The cards, charts and tables for the dates and filters. The open card's list is asked for
  // on its own (below), so opening a card, paging, sorting or searching never runs the whole
  // page's queries again.
  const result = useReport(
    "impact",
    {
      ...period,
      filters: filters.join(","),
      reason,
      ...errorParams(error),
    },
    [revision, retry],
  );

  // What the open list is for: the card, dates and filters. A page, search or sort of the
  // same list is not part of it, so the rows stay (dimmed) while the next page loads and the
  // drawer never flickers shut; anything else shows "Loading" rather than another list's rows.
  const listScope = JSON.stringify([period, category, filters, reason, error]);
  // While new numbers load, the old ones stay on screen, dimmed, instead of the page emptying.
  const [list, setList] = useState(null);
  useEffect(() => {
    if (result.data)
      setShown({ data: result.data, period, filters, reason, error });
  }, [result.data]);
  // The numbers on screen and the choices they were counted for. The headline's dates and the
  // chips are built from these, never from choices whose numbers haven't arrived.
  const view = result.data
    ? { data: result.data, period, filters, reason, error }
    : shown;
  const data = view?.data;
  // A card the page doesn't know (an old or edited link) is never asked for.
  const known = Boolean(category && (!data || data.summary.groups[category]));

  // The open card's sessions: one page of them, and how far they all got. only=list makes the
  // server run just those 2 queries; the rest of the page is already on screen.
  const listResult = useReport(
    known ? "impact" : "",
    {
      ...period,
      category,
      only: "list",
      page,
      search,
      filters: filters.join(","),
      reason,
      ...errorParams(error),
      ...(sort.key ? { sort: sort.key, order: sort.order } : {}),
    },
    [revision, retry],
  );
  useEffect(() => {
    if (listResult.data)
      setList({ scope: listScope, sessions: listResult.data.sessions });
  }, [listResult.data]);

  // An unknown card is dropped from the address bar instead of breaking the page. The address
  // is replaced, not added to, so Back doesn't return to the broken link.
  useEffect(() => {
    if (category && data && !data.summary.groups[category]) {
      writeUrl({ card: "", session: "" }, true);
      setCategory(null);
    }
  }, [category, data]);

  // Opens a group's sessions in the drawer. `source` is the card title clicked, if any.
  function open(next, source = null) {
    setFrom(source);
    setCategory(next);
    firstPage();
  }

  // Changes what the page is narrowed to; the picked error stays unless one is given.
  // The list goes back to page 1, as the page it was on may no longer exist.
  function filter(nextFilters, nextReason, nextError = error) {
    setFilters(nextFilters);
    setReason(nextReason);
    setError(nextError);
    setPage(1);
  }

  // Picking an error keeps the sessions that had it and lists them.
  function pickError(row) {
    filter(filters, reason, {
      code: row.code,
      event: row.event,
      stage: row.stage,
      phase: row.phase,
      reason: row.reason,
      afterEnd: row.after_end,
    });
    open("all");
  }

  // Clicking a reason anywhere keeps only those sessions; clicking it again shows them all.
  function pickReason(text) {
    filter(filters, reason === text ? "" : text);
  }

  // Until the first numbers arrive: grey placeholders, so the page never jumps, or the
  // error with a way out.
  if (!data)
    return (
      <section className="section-block">
        <Notice error={result.error} />
        {/* Reset drops the open card and every filter, in case the link's choices
            are what the server couldn't answer. */}
        {result.error ? (
          <button
            type="button"
            onClick={() => {
              setCategory(null);
              filter([], "", null);
            }}
          >
            Reset view
          </button>
        ) : (
          <div
            className="daily-metrics"
            role="status"
            aria-busy="true"
            aria-label="Loading numbers"
          >
            {[1, 2, 3, 4, 5].map((n) => (
              <div key={n} className="panel compact-metric skeleton" />
            ))}
          </div>
        )}
      </section>
    );

  // How many days the numbers on screen cover, counting both ends; the comparison is the
  // same length.
  const days =
    (new Date(view.period.end) - new Date(view.period.start)) / 86400000 + 1;
  const versus = versusWords(days);
  // The dates in words: the headline's are those of the numbers on screen.
  const when = datesText(view.period);

  const summary = data.summary;
  // The server compares with the same weekdays a week earlier (under 7 days) or the same
  // number of days just before. If that period starts before the data does, it is only
  // partly filled, so no comparison is shown rather than a false "Up".
  const shift = days < 7 ? 7 : days;
  const beforeStart = new Date(Date.parse(view.period.start) - shift * 86400000)
    .toISOString()
    .slice(0, 10);
  const before = dataStart && beforeStart < dataStart ? null : data.previous;
  const groups = summary.groups;
  // What every card is built from; see cardHelpers in cards.jsx.
  const cardProps = { data, before, days, versus, category, onOpen: open };

  return (
    <section className="section-block">
      {/* A failed update keeps the numbers already shown and offers another go. */}
      {result.error && (
        <p className="notice error" role="alert">
          Couldn&apos;t update: {result.error} Showing the previous numbers.{" "}
          <button
            type="button"
            className="link-button"
            onClick={() => setRetry((n) => n + 1)}
          >
            Try again
          </button>
        </p>
      )}
      <div className="impact-layout">
        <FilterPanel
          facets={data.facets}
          filters={filters}
          reason={reason}
          onChange={filter}
        />

        {/* "updating" dims the old numbers while new ones load. */}
        <div
          className={"impact-main" + (result.loading ? " updating" : "")}
          aria-busy={Boolean(result.loading)}
        >
          <ActiveFilters
            shown={view}
            current={{ filters, reason }}
            titles={data.titles}
            sections={data.facets.sections}
            onChange={filter}
          />
          <Headline
            summary={summary}
            before={before}
            when={when}
            versus={versus}
            onClear={
              view.filters.length || view.reason || view.error
                ? () => filter([], "", null)
                : null
            }
            onOpen={open}
          />

          {/* With no sessions the headline says so, and nothing else is drawn. */}
          {summary.sessions > 0 && (
            <>
              <HeadlineCards {...cardProps} />

              <Charts
                groups={groups}
                reasons={data.facets.reasons}
                reason={reason}
                category={category}
                onOpen={open}
                // A reason in the chart narrows the page to it and lists those sessions.
                // Clicking it again only takes the reason away; no list opens for that.
                onReason={(text) => {
                  pickReason(text);
                  if (reason !== text) open("no_success");
                }}
              />

              <DetailSections {...cardProps} />

              <ErrorReasons
                rows={data.error_events}
                error={error}
                onPick={pickError}
              />
            </>
          )}
        </div>
      </div>

      {/* The drawer opens for any known group; an unknown card in an old link is dropped above. */}
      {category && groups[category] && (
        <Drawer
          title={groups[category].title}
          onClose={() => setCategory(null)}
        >
          {/* Until this list's own rows arrive, say so rather than show another card's, or
              this card's for other dates or filters. A failed request says why instead. */}
          {list?.scope !== listScope ? (
            <Notice error={listResult.error} loading>
              Loading sessions…
            </Notice>
          ) : (
            <>
              <Notice error={listResult.error} />
              <AffectedSessions
                // A new card or new dates start the list afresh.
                key={category + period.start + period.end}
                category={category}
                reason={reason}
                onReason={pickReason}
                group={groups[category]}
                sessions={list.sessions}
                busy={Boolean(listResult.loading)}
                sort={sort}
                // A new sort or search starts again from page 1.
                onSort={(next) => {
                  setSort(next);
                  setPage(1);
                }}
                // What the list is limited to, in words: the dates (in UTC, as the database
                // counts days) and every filter.
                scope={[
                  datesText(period) + " (UTC)",
                  ...filters.map((key) => data.titles[key] || key),
                  reason,
                  error && errorText(error),
                ]
                  .filter(Boolean)
                  .join(" · ")}
                from={from}
                // With an error or reason picked, the list shows error columns instead.
                errorView={Boolean(error || reason)}
                search={search}
                onSearch={(text) => {
                  setSearch(text);
                  setPage(1);
                }}
                page={page}
                onPage={setPage}
              />
            </>
          )}
        </Drawer>
      )}
    </section>
  );
}
