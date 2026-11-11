import { useEffect, useRef, useState } from "react";
import { Dialog } from "./primitives";
import { SearchWork, type WorkEvent } from "../search/work";
import {
  buildCardContent,
  readCardContentPage,
  disposeCardContent,
  type CardContentInput,
  type CardContentReader,
  type CardContentPage,
  type CardContentSide,
  type CardContentCursor,
} from "../study/cardContent";

/** Bounded read-only projection. Identity/authority remains the actual Study owner's responsibility. */
export function CardSearchPreview({
  input,
  deckTitle,
  isCurrent,
  scopeVersion,
  onClose,
  onBack,
  onOpenSource,
}: {
  input: CardContentInput;
  deckTitle: string;
  isCurrent: () => boolean;
  scopeVersion: number;
  onClose: () => void;
  onBack: () => void;
  onOpenSource?: () => void;
}) {
  const [side, setSide] = useState<CardContentSide>("front"),
    [pages, setPages] = useState<
      Partial<Record<CardContentSide, CardContentPage>>
    >({});
  const [busy, setBusy] = useState(false),
    [paused, setPaused] = useState(false),
    [error, setError] = useState("");
  const reader = useRef<CardContentReader | null>(null),
    running = useRef(false),
    work = useRef<SearchWork<{
      side: CardContentSide;
      page: CardContentPage;
    }> | null>(null),
    generation = useRef(0),
    abort = useRef<AbortController | null>(null),
    alive = useRef(false);
  const check = useRef(isCurrent);
  check.current = isCurrent;
  const valid = isCurrent();
  function assertCurrent() {
    if (!alive.current || !check.current())
      throw Error("Card is no longer current.");
  }
  async function run(ticket: number) {
    const operation = work.current;
    if (!operation || running.current) return;
    running.current = true;
    setBusy(true);
    setPaused(false);
    setError("");
    try {
      const result = await operation.round(abort.current?.signal);
      if (ticket !== generation.current || !alive.current) return;
      if (result.status === "paused") setPaused(true);
      else {
        setPages((value) => ({
          ...value,
          [result.value.side]: result.value.page,
        }));
        work.current = null;
        operation.close();
      }
    } catch {
      if (ticket === generation.current && alive.current) {
        work.current = null;
        setError(
          "This card couldn’t be displayed. Return to search to open it again.",
        );
      }
    } finally {
      if (ticket === generation.current && alive.current) {
        running.current = false;
        setBusy(false);
      }
    }
  }
  useEffect(() => {
    alive.current = true;
    running.current = false;
    const ticket = ++generation.current;
    abort.current = new AbortController();
    function* initial(): Generator<
      WorkEvent,
      { side: CardContentSide; page: CardContentPage },
      void
    > {
      const value = yield* buildCardContent(input);
      reader.current = value;
      const page = yield* readCardContentPage(value, "front");
      return { side: "front", page };
    }
    work.current = new SearchWork(
      initial(),
      undefined,
      undefined,
      assertCurrent,
    );
    void run(ticket);
    return () => {
      alive.current = false;
      running.current = false;
      generation.current++;
      abort.current?.abort();
      work.current?.close();
      work.current = null;
      if (reader.current) disposeCardContent(reader.current);
      reader.current = null;
    };
  }, [input]);
  useEffect(() => {
    if (!valid) {
      generation.current++;
      abort.current?.abort();
      work.current?.close();
      work.current = null;
      if (reader.current) disposeCardContent(reader.current);
      reader.current = null;
      setPages({});
      setBusy(false);
      setPaused(false);
    }
  }, [valid, scopeVersion]);
  function read(side: CardContentSide, cursor?: CardContentCursor) {
    if (
      running.current ||
      busy ||
      paused ||
      !reader.current ||
      !check.current()
    )
      return;
    const value = reader.current,
      ticket = ++generation.current;
    abort.current?.abort();
    abort.current = new AbortController();
    function* next(): Generator<
      WorkEvent,
      { side: CardContentSide; page: CardContentPage },
      void
    > {
      return { side, page: yield* readCardContentPage(value, side, cursor) };
    }
    work.current = new SearchWork(next(), undefined, undefined, assertCurrent);
    void run(ticket);
  }
  const page = pages[side];
  return (
    <Dialog title="Card" onClose={onClose} className="search-card-preview">
      {!valid ? (
        <p role="status">
          This card changed or is no longer available. Return to search to open
          it again.
        </p>
      ) : (
        <>
          <p className="search-scope">
            Deck: {deckTitle} ·{" "}
            {input.type === "basic"
              ? "Basic"
              : input.type === "reversed"
                ? input.key === "reversed:reverse"
                  ? "Reversed · reverse"
                  : "Reversed · forward"
                : "Cloze"}{" "}
            · Read-only
          </p>
          <h3>{side === "front" ? "Question" : "Answer"}</h3>
          {page && (
            <>
              <pre className="search-card-text">{page.text || "(Empty)"}</pre>
              <div className="search-pagination">
                <span
                  className="search-card-range"
                  tabIndex={-1}
                  aria-live="polite"
                >
                  {page.total === 0 ? "0" : `${page.start + 1}–${page.end}`} of{" "}
                  {page.total} characters
                </span>
                <button
                  disabled={busy || paused || !page.previous}
                  onClick={(event) => {
                    event.currentTarget.parentElement
                      ?.querySelector<HTMLElement>(".search-card-range")
                      ?.focus();
                    if (page.previous) read(side, page.previous);
                  }}
                >
                  Previous
                </button>
                <button
                  disabled={busy || paused || !page.next}
                  onClick={(event) => {
                    event.currentTarget.parentElement
                      ?.querySelector<HTMLElement>(".search-card-range")
                      ?.focus();
                    if (page.next) read(side, page.next);
                  }}
                >
                  Next
                </button>
              </div>
            </>
          )}
          {busy && <p role="status">Loading card content…</p>}
          {paused && (
            <div role="status">
              <p>This card needs more time to display.</p>
              <button onClick={() => void run(generation.current)}>
                Continue
              </button>
            </div>
          )}
          {error && <p role="alert">{error}</p>}
          <button
            disabled={!reader.current}
            aria-disabled={busy || paused}
            onClick={() => {
              if (running.current || busy || paused) return;
              const next = side === "front" ? "back" : "front";
              setSide(next);
              if (!pages[next]) read(next);
            }}
          >
            {side === "front" ? "Show answer" : "Hide answer"}
          </button>
          {onOpenSource && <button onClick={onOpenSource}>Open in note</button>}
        </>
      )}
      <div className="actions">
        <button onClick={onClose}>Back to Study</button>
        <button onClick={onBack}>Back to search</button>
      </div>
    </Dialog>
  );
}
