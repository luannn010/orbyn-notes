import { useRef, useState, type ReactNode } from "react";
import { FileText, Layers, Paperclip, Search } from "./icons";
import type { SearchExcerpt } from "../search/matching";
import type {
  SearchCursor,
  SearchHandle,
  SearchKind,
  SearchLocator,
  SearchState,
} from "../search/results";
import "../styles/search.css";

export type SearchTab = "all" | SearchKind;
export type SearchViewProps = {
  state: SearchState;
  query: string;
  tab: SearchTab;
  onQueryChange: (raw: string, composing?: boolean) => void;
  onSubmit: (raw: string) => void;
  onTabChange: (tab: SearchTab) => void;
  onClear: () => void;
  onOpen: (locator: SearchLocator) => void;
  onPage: (cursor: SearchCursor) => void;
  onContinue: (handle: SearchHandle) => void;
  onCancelPage: () => void;
  onCancel: () => void;
  navigationState?: "opening" | "blocked" | "unavailable" | null;
};
const names = {
  all: "All",
  note: "Notes",
  clip: "Clips",
  card: "Cards",
} as const;
const fields = {
  all: "all",
  note: "notes",
  clip: "clips",
  card: "cards",
} as const;
const tabs: readonly SearchTab[] = ["all", "note", "clip", "card"];

/** Escaped original text only. Ranges are presentation hints, never HTML or navigation identity. */
function MarkedExcerpt({ excerpt }: { excerpt: SearchExcerpt }) {
  const nodes: ReactNode[] = [];
  let position = 0;
  for (const range of excerpt.matches) {
    if (!Number.isSafeInteger(range.from) || !Number.isSafeInteger(range.to))
      continue;
    let from = Math.max(position, Math.min(excerpt.text.length, range.from));
    let to = Math.max(from, Math.min(excerpt.text.length, range.to));
    // Never cut a surrogate pair even if a malformed presentation range arrives.
    if (
      from > 0 &&
      /[\uDC00-\uDFFF]/.test(excerpt.text[from] ?? "") &&
      /[\uD800-\uDBFF]/.test(excerpt.text[from - 1] ?? "")
    )
      from--;
    from = Math.max(position, from);
    if (
      to < excerpt.text.length &&
      /[\uDC00-\uDFFF]/.test(excerpt.text[to] ?? "") &&
      /[\uD800-\uDBFF]/.test(excerpt.text[to - 1] ?? "")
    )
      to++;
    if (to <= from) continue;
    nodes.push(excerpt.text.slice(position, from));
    nodes.push(
      <mark key={`${from}:${to}`} className="search-match">
        {excerpt.text.slice(from, to)}
      </mark>,
    );
    position = to;
  }
  nodes.push(excerpt.text.slice(position));
  return (
    <>
      {excerpt.before && "…"}
      {nodes}
      {excerpt.after && "…"}
    </>
  );
}

/** Controlled presentation. The owning route admits work, scopes navigation and disposes private projections. */
// design: notes/search
export function SearchView(props: SearchViewProps) {
  const { state, query, tab, navigationState } = props;
  const composing = useRef(false);
  const [activeResult, setActiveResult] = useState(0);
  const resultArea = useRef<HTMLElement>(null);
  const ready = state.status === "ready" ? state : null;
  const visibleGroups = ready?.groups.filter((group) =>
    tab === "all" ? group.items.length > 0 : tab === group.kind,
  ) ?? [];
  const visibleResults = visibleGroups.flatMap((group) => group.items);
  const selectedResult = Math.min(activeResult, Math.max(0, visibleResults.length - 1));
  // design: notes/search-empty
  const empty = ready?.counts.all === 0;
  const busy = state.status === "pending";
  const error =
    state.status === "error"
      ? {
          "query-too-long": "Use at most 200 characters for a search.",
          "query-invalid":
            "Finish entering the current character before searching.",
          "query-too-many-terms":
            "Use at most 12 different words for a search.",
          "source-unavailable": "Couldn’t search your local data. Try again.",
        }[state.code]
      : "";
  return (
    <section ref={resultArea} className="unified-search" aria-label="Search" onKeyDown={(event) => {
      if (composing.current || event.nativeEvent.isComposing || !["ArrowDown", "ArrowUp"].includes(event.key)) return;
      const target = event.target as HTMLElement;
      if (target.tagName !== "INPUT" && !target.classList.contains("search-result")) return;
      const buttons = Array.from(resultArea.current?.querySelectorAll<HTMLButtonElement>(".search-result:not(:disabled)") ?? []);
      if (!buttons.length) return;
      event.preventDefault();
      if (target.tagName === "INPUT") {
        const next = (selectedResult + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
        setActiveResult(next);
        buttons[next]?.scrollIntoView?.({ block: "nearest" });
        return;
      }
      const current = buttons.indexOf(target as HTMLButtonElement);
      const next = current < 0 ? (event.key === "ArrowDown" ? 0 : buttons.length - 1) : (current + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
      setActiveResult(next);
      buttons[next]?.focus();
    }}>
      <div className="search-content">
        <form
          className="search-query"
          onSubmit={(event) => {
            event.preventDefault();
            if (!composing.current && navigationState !== "opening") {
              const buttons = resultArea.current?.querySelectorAll<HTMLButtonElement>(".search-result:not(:disabled)");
              if (ready && ready.raw === query && buttons?.length) buttons[selectedResult]?.click();
              else props.onSubmit(query);
            }
          }}
        >
          <label className="search-input">
            <Search size={13} aria-hidden="true" />
            <input
              value={query}
              aria-label="Search notes, clips and cards"
              aria-describedby="search-scope"
              placeholder="Search notes, clips and cards"
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => { setActiveResult(0); props.onQueryChange(event.target.value, composing.current); }}
              onCompositionStart={() => {
                composing.current = true;
                props.onQueryChange(query, true);
              }}
              onCompositionEnd={(event) => {
                composing.current = false;
                props.onQueryChange(event.currentTarget.value, false);
              }}
              onKeyDown={(event) => {
                if (
                  event.key === "Enter" &&
                  (composing.current || event.nativeEvent.isComposing)
                )
                  event.preventDefault();
                if (event.key === "Escape") {
                  event.preventDefault();
                  if (!composing.current && !event.nativeEvent.isComposing) props.onClear();
                }
              }}
            />
          </label>
        </form>
        <p className="search-scope" id="search-scope">
          Notes, clips and cards. Journal stays private.
        </p>
        <span className="search-active-announcement" aria-live="polite">{visibleResults[selectedResult] ? `Result ${selectedResult + 1} of ${visibleResults.length}: ${visibleResults[selectedResult].primary.text}` : ""}</span>
        {query.trim() && <div
          className="search-tabs"
          role="group"
          aria-label="Search categories"
          onKeyDown={(event) => {
            if (
              !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key) ||
              !(event.target instanceof HTMLButtonElement)
            )
              return;
            const buttons = Array.from(
              event.currentTarget.querySelectorAll<HTMLButtonElement>("button"),
            );
            const position = buttons.indexOf(event.target);
            if (position < 0) return;
            event.preventDefault();
            const next =
              event.key === "Home"
                ? 0
                : event.key === "End"
                  ? buttons.length - 1
                  : (position +
                      (event.key === "ArrowRight" ? 1 : -1) +
                      buttons.length) %
                    buttons.length;
            buttons[next]?.focus();
            setActiveResult(0);
            props.onTabChange(tabs[next]!);
          }}
        >
          {tabs.map((value) => (
            <button
              key={value}
              aria-pressed={tab === value}
              onClick={() => { setActiveResult(0); props.onTabChange(value); }}
            >
              {names[value]}
              {ready && (
                <>
                  {" "}
                  <span>{ready.counts[fields[value]]}</span>
                </>
              )}
            </button>
          ))}
        </div>}
        {!query.trim() && (
          <p className="search-hint">Type to search your notes, clips and cards.</p>
        )}
        {busy && (
          <div className="search-feedback" role="status" aria-live="polite">
            <p>Searching local notes, clips and cards…</p>
            <button onClick={props.onCancel}>Cancel search</button>
          </div>
        )}
        {state.status === "paused-limit" && (
          <div className="search-feedback" role="status">
            <h2>Search is paused</h2>
            <p>Continue to check the remaining items.</p>
            <button onClick={() => props.onContinue(state.handle)}>
              Continue
            </button>
            <button onClick={props.onCancel}>Cancel search</button>
          </div>
        )}
        {state.status === "changed" && (
          <div className="search-feedback" role="status">
            <h2>Your library changed</h2>
            <p>Search again to see current results.</p>
            <button onClick={() => props.onSubmit(query)}>Search again</button>
          </div>
        )}
        {error && (
          <div className="search-feedback" role="alert">
            <p>{error}</p>
            {state.status === "error" &&
              state.code === "source-unavailable" && (
                <button onClick={() => props.onSubmit(query)}>Try again</button>
              )}
          </div>
        )}
        {navigationState && (
          <p className="search-navigation" role="status">
            {navigationState === "opening"
              ? "Opening item…"
              : navigationState === "blocked"
                ? "Finish or discard your unsaved changes before leaving."
                : "This item is no longer available."}
          </p>
        )}
        {empty && (
          <div className="search-empty">
            <h2>No results for “{ready.raw}”</h2>
            <p>Nothing in your notes, clips or cards. Try fewer words.</p>
            <button onClick={props.onClear}>Clear search</button>
          </div>
        )}
        {ready &&
          !empty &&
          visibleGroups.map((group, groupIndex) => {
              const total = ready.counts[fields[group.kind]],
                page = ready.page?.kind === group.kind ? ready.page : null;
              const Icon =
                group.kind === "note"
                  ? FileText
                  : group.kind === "clip"
                    ? Paperclip
                    : Layers;
              return (
                <section
                  className="search-group"
                  aria-label={`${names[group.kind]} results`}
                  key={group.kind}
                >
                  <h2>
                    {names[group.kind]} <span>{total}</span>
                  </h2>
                  {group.items.length === 0 ? (
                    <p className="search-no-category">
                      No {names[group.kind].toLowerCase()} for “{ready.raw}”.
                    </p>
                  ) : (
                    <ul>
                      {group.items.map((hit, index) => (
                        <li key={index}>
                          <button
                            type="button"
                            className="search-result"
                            data-active={selectedResult === visibleGroups.slice(0, groupIndex).reduce((total, previous) => total + previous.items.length, 0) + index}
                            onFocus={(event) => {
                              const buttons = Array.from(resultArea.current?.querySelectorAll<HTMLButtonElement>(".search-result:not(:disabled)") ?? []);
                              setActiveResult(buttons.indexOf(event.currentTarget));
                            }}
                            disabled={navigationState === "opening"}
                            onClick={() => props.onOpen(hit.locator)}
                          >
                            <b>
                              <Icon size={16} aria-hidden="true" />
                              <span>
                                <MarkedExcerpt excerpt={hit.primary} />
                              </span>
                            </b>
                            {hit.secondary
                              .filter(
                                (excerpt, index, all) =>
                                  all.findIndex(
                                    (other) =>
                                      other.text === excerpt.text &&
                                      other.before === excerpt.before &&
                                      other.after === excerpt.after &&
                                      JSON.stringify(other.matches) ===
                                        JSON.stringify(excerpt.matches),
                                  ) === index,
                              )
                              .map((excerpt, at) => (
                                <small key={at}>
                                  <MarkedExcerpt excerpt={excerpt} />
                                </small>
                              ))}
                            {(hit.archived ||
                              hit.clipContent ||
                              hit.deckTitle) && (
                              <small className="search-provenance">
                                {[
                                  hit.archived ? "Archived" : "",
                                  hit.clipContent === "saved-text"
                                    ? "Saved text"
                                    : hit.clipContent === "link-only"
                                      ? "Link only"
                                      : "",
                                  hit.deckTitle ? `Deck: ${hit.deckTitle}` : "",
                                ]
                                  .filter(Boolean)
                                  .join(" · ")}
                              </small>
                            )}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  {(group.previous || group.next || group.offset > 0) && (
                    <div className="search-pagination">
                      <span
                        className="search-page-range"
                        tabIndex={-1}
                        aria-live="polite"
                      >
                        {names[group.kind]} {group.offset + 1}–
                        {group.offset + group.items.length} of {total}
                      </span>
                      <button
                        aria-label={`Previous ${names[group.kind]} results`}
                        disabled={!group.previous || !!ready.page}
                        onClick={(event) => {
                          event.currentTarget.parentElement
                            ?.querySelector<HTMLElement>(".search-page-range")
                            ?.focus();
                          if (group.previous) props.onPage(group.previous);
                        }}
                      >
                        Previous
                      </button>
                      <button
                        aria-label={`Next ${names[group.kind]} results`}
                        disabled={!group.next || !!ready.page}
                        onClick={(event) => {
                          event.currentTarget.parentElement
                            ?.querySelector<HTMLElement>(".search-page-range")
                            ?.focus();
                          if (group.next) props.onPage(group.next);
                        }}
                      >
                        Next
                      </button>
                    </div>
                  )}
                  {page && (
                    <div className="search-page-feedback" role="status">
                      <p>
                        {page.status === "pending"
                          ? "Loading results…"
                          : page.status === "paused"
                            ? "This results page needs more time."
                            : "This results page couldn’t load."}
                      </p>
                      {page.status !== "pending" && (
                        <button onClick={() => props.onContinue(page.handle)}>
                          {page.status === "paused" ? "Continue" : "Retry"}
                        </button>
                      )}
                      <button onClick={props.onCancelPage}>Cancel page</button>
                    </div>
                  )}
                </section>
              );
            })}
      </div>
    </section>
  );
}
