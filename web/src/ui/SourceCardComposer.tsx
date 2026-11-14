import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import type { CollectionsStore, Deck } from "../collections/contracts";
import type { NotesLibrary } from "../library/contracts";
import type {
  MakeCardDraft,
  MakeCardIntent,
  MakeCardResult,
  SavedNoteSelection,
  SourceExpected,
  StudySourceService,
  UndoMakeCardIntent,
} from "../study/sourceContracts";
import type { EditorSourceCapture } from "./RichEditor";
import { registerCloseGuard, trackOperation } from "../desktop/closeGuard";
import { Dialog } from "./primitives";
import { message } from "./model";
import "../styles/study-source.css";
function exitDuration(node: HTMLElement | null) {
  if (!node) return 140;
  const style = getComputedStyle(node);
  if (style.animationName === "none") return 0;
  const durations = style.animationDuration
    .split(",")
    .map(
      (value) => parseFloat(value) * (value.trim().endsWith("ms") ? 1 : 1000),
    )
    .filter(Number.isFinite);
  return durations.length ? Math.max(...durations) : 140;
}
function isExitEnd(
  event: AnimationEvent,
  node: HTMLElement | null,
  ordinary: string,
) {
  if (!node || event.target !== node) return false;
  const names = getComputedStyle(node)
    .animationName.split(",")
    .map((name) => name.trim());
  if (names.includes("none")) return false;
  const expected = names.filter(
    (name) => name === ordinary || name === "source-fade-out",
  );
  return expected.length
    ? expected.includes(event.animationName)
    : event.animationName === ordinary;
}
export type SourceCardOwners = {
  library: NotesLibrary;
  collections: CollectionsStore;
  service: StudySourceService;
};
async function tokens(owners: SourceCardOwners): Promise<SourceExpected> {
  const [library, collections] = await Promise.all([
    owners.library.read(),
    owners.collections.read(),
  ]);
  if (library.mode !== "ready")
    throw new Error("The library is read-only. Your card draft is still here.");
  return {
    library: library.snapshot.token,
    collections: { epoch: collections.epoch, revision: collections.revision },
  };
}
const conflictCode = (failure: unknown) =>
  failure &&
  typeof failure === "object" &&
  "code" in failure &&
  [
    "source_conflict",
    "source_stale",
    "source_revoked",
    "source_undo_unavailable",
    "source_operation_reused",
  ].includes(String(failure.code));
export function SourceCardComposer({
  owners,
  capture,
  stale,
  hidden,
  onReselect,
  flush,
  onClose,
  onAdded,
}: {
  owners: SourceCardOwners;
  capture: EditorSourceCapture;
  stale: boolean;
  hidden: boolean;
  onReselect: () => void;
  flush: (capture: EditorSourceCapture) => Promise<SavedNoteSelection>;
  onClose: (restore: boolean) => void;
  onAdded: (result: MakeCardResult) => void;
}) {
  const [type, setType] = useState<"basic" | "reversed" | "cloze">("basic"),
    [front, setFront] = useState(""),
    [back, setBack] = useState(capture.selection.passage.quote),
    [deckId, setDeckId] = useState(""),
    [decks, setDecks] = useState<Deck[]>([]),
    [selection, setSelection] = useState<SavedNoteSelection | null>(null),
    [barrierError, setBarrierError] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [conflict, setConflict] = useState(false),
    [reloaded, setReloaded] = useState(false),
    [discard, setDiscard] = useState(false),
    [notice, setNotice] = useState(""),
    [attempt, setAttempt] = useState(0),
    [position, setPosition] = useState<React.CSSProperties>({
      visibility: "hidden",
    });
  const root = useRef<HTMLDivElement>(null),
    alive = useRef(false),
    version = useRef(0),
    dirty = useRef(false),
    pending = useRef(false),
    held = useRef<MakeCardIntent | null>(null),
    closeRef = useRef(onClose),
    flushRef = useRef(flush),
    ownersRef = useRef(owners);
  closeRef.current = onClose;
  flushRef.current = flush;
  ownersRef.current = owners;
  const [sheet, setSheet] = useState(false);
  const [closing, setClosing] = useState(false);
  const closingRef = useRef(false),
    exitAction = useRef<(() => void) | null>(null);
  function beginExit(action: () => void) {
    if (closingRef.current) return;
    closingRef.current = true;
    exitAction.current = action;
    setClosing(true);
  }
  useLayoutEffect(() => {
    if (!closing) return;
    const node = root.current,
      ticket = version.current;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      if (alive.current && ticket === version.current) exitAction.current?.();
    };
    const end = (event: AnimationEvent) => {
      if (isExitEnd(event, node, "source-pop-out")) finish();
    };
    node?.addEventListener("animationend", end);
    const timer = setTimeout(finish, exitDuration(node) + 34);
    return () => {
      clearTimeout(timer);
      node?.removeEventListener("animationend", end);
    };
  }, [closing]);
  const context = capture.selection.context,
    blankText =
      context.text.slice(0, context.selectionFrom) +
      "{{selection}}" +
      context.text.slice(context.selectionTo),
    clozeUnavailable =
      blankText.replace("{{selection}}", "").includes("{{") ||
      blankText.replace("{{selection}}", "").includes("}}");
  const unavailable = stale || !capture.isCurrent();
  useLayoutEffect(() => {
    alive.current = true;
    const stop = owners.service.onInvalidate(() => {
      version.current++;
      held.current = null;
      dirty.current = false;
      pending.current = false;
      if (alive.current) flushSync(() => closeRef.current(false));
    });
    return () => {
      alive.current = false;
      version.current++;
      stop();
    };
  }, [owners.service]);
  useLayoutEffect(
    () =>
      registerCloseGuard(() => {
        if (dirty.current || pending.current || held.current) {
          setNotice("Finish or discard this card draft before leaving.");
          return false;
        }
        return true;
      }),
    [],
  );
  useEffect(() => {
    const prevent = (event: BeforeUnloadEvent) => {
      if (dirty.current || pending.current || held.current)
        event.preventDefault();
    };
    window.addEventListener("beforeunload", prevent);
    return () => window.removeEventListener("beforeunload", prevent);
  }, []);
  useEffect(() => {
    const current = ++version.current;
    setSelection(null);
    setBarrierError("");
    void trackOperation(async () => {
      const [saved, collection] = await Promise.all([
        flushRef.current(capture),
        ownersRef.current.collections.read(),
      ]);
      if (!alive.current || current !== version.current) return;
      setSelection(saved);
      setDecks(collection.study.decks);
      setDeckId((id) =>
        collection.study.decks.some((deck) => deck.id === id)
          ? id
          : collection.study.decks.length === 1
            ? collection.study.decks[0]!.id
            : "",
      );
    }).catch((failure) => {
      if (alive.current && current === version.current)
        setBarrierError(message(failure));
    });
  }, [capture, attempt]);
  useLayoutEffect(() => {
    if (hidden) return;
    const pane = root.current?.closest<HTMLElement>(".editor-pane");
    const place = () => {
      const node = root.current;
      if (!node) return;
      const viewport = window.visualViewport;
      const visible = {
        left: viewport?.offsetLeft ?? 0,
        top: viewport?.offsetTop ?? 0,
        width: viewport?.width ?? innerWidth,
        height: viewport?.height ?? innerHeight,
      };
      const bounds = pane?.getBoundingClientRect();
      const left = Math.max(
          visible.left,
          bounds && bounds.width > 0 ? bounds.left : visible.left,
        ),
        right = Math.min(
          visible.left + visible.width,
          bounds && bounds.width > 0
            ? bounds.right
            : visible.left + visible.width,
        ),
        top = Math.max(
          visible.top,
          bounds && bounds.height > 0 ? bounds.top : visible.top,
        ),
        bottom = Math.min(
          visible.top + visible.height,
          bounds && bounds.height > 0
            ? bounds.bottom
            : visible.top + visible.height,
        );
      const width = Math.max(1, right - left),
        height = Math.max(1, bottom - top),
        useSheet = visible.width < 500 || width < 376;
      setSheet(useSheet);
      if (useSheet) {
        setPosition({
          position: "fixed",
          left: left + 8,
          bottom: Math.max(0, innerHeight - bottom),
          width: Math.max(1, width - 16),
          maxHeight: Math.max(1, height - 16),
        });
        return;
      }
      let anchor: { left: number; top: number; bottom: number };
      try {
        anchor = capture.anchor();
      } catch {
        anchor = {
          left: left + (width - 360) / 2,
          top: top + 10,
          bottom: top + 10,
        };
      }
      const actualHeight = Math.min(node.offsetHeight, height - 16);
      setPosition({
        position: "fixed",
        left: Math.max(left + 8, Math.min(anchor.left, right - 368)),
        top: Math.max(
          top + 8,
          Math.min(
            anchor.bottom + 10 + actualHeight <= bottom - 8
              ? anchor.bottom + 10
              : anchor.top - actualHeight - 10,
            bottom - actualHeight - 8,
          ),
        ),
        width: 360,
        maxHeight: Math.max(1, height - 16),
      });
    };
    place();
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(place);
    if (root.current) observer?.observe(root.current);
    if (pane) observer?.observe(pane);
    const viewport = window.visualViewport;
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    viewport?.addEventListener("resize", place);
    viewport?.addEventListener("scroll", place);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      viewport?.removeEventListener("resize", place);
      viewport?.removeEventListener("scroll", place);
    };
  }, [hidden, capture]);
  const openingFocused = useRef(new WeakSet<EditorSourceCapture>());
  useLayoutEffect(() => {
    const node = root.current;
    if (
      hidden ||
      closing ||
      position.visibility === "hidden" ||
      !node ||
      node.closest("[inert]") ||
      getComputedStyle(node).visibility !== "visible" ||
      openingFocused.current.has(capture)
    )
      return;
    const firstField = node.querySelector<HTMLElement>("textarea,select");
    firstField?.focus({ preventScroll: true });
    if (document.activeElement === firstField)
      openingFocused.current.add(capture);
  }, [hidden, closing, position.visibility, capture]);
  function cancel() {
    if (pending.current || closingRef.current) return;
    if (dirty.current || held.current) setDiscard(true);
    else beginExit(() => closeRef.current(true));
  }
  useEffect(() => {
    if (hidden) return;
    const outside = (event: MouseEvent) => {
      if (
        root.current?.contains(event.target as Node) ||
        (event.target instanceof Element &&
          event.target.closest("[data-preserves-editor-draft]"))
      )
        return;
      if (closingRef.current) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (discard) return;
      if (pending.current || dirty.current || held.current) {
        event.preventDefault();
        event.stopPropagation();
        setNotice("Finish or cancel this card draft before leaving.");
      } else {
        event.preventDefault();
        event.stopPropagation();
        beginExit(() => closeRef.current(false));
      }
    };
    document.addEventListener("click", outside, true);
    return () => document.removeEventListener("click", outside, true);
  }, [hidden, discard]);
  async function commit(intent: MakeCardIntent) {
    const current = version.current;
    try {
      const result = await ownersRef.current.service.commit(intent);
      if (alive.current && current === version.current) {
        held.current = null;
        dirty.current = false;
        beginExit(() => onAdded(result));
      }
    } catch (failure) {
      if (alive.current && current === version.current) {
        setError(message(failure));
        setConflict(!!conflictCode(failure));
        setReloaded(false);
      }
    }
  }
  async function add() {
    if (
      closingRef.current ||
      pending.current ||
      held.current ||
      !selection ||
      unavailable
    )
      return;
    const current = version.current,
      source = structuredClone(selection);
    const draft: MakeCardDraft =
      type === "cloze"
        ? {
            type: "cloze",
            deckId,
            tags: [],
            text: blankText,
            blanks: [
              { id: "selection", answer: capture.selection.passage.quote },
            ],
          }
        : { type, deckId, tags: [], front, back };
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      await trackOperation(async () => {
        const expected = await tokens(ownersRef.current);
        if (
          !alive.current ||
          current !== version.current ||
          !capture.isCurrent()
        )
          throw new Error(
            "This passage changed. Select it again before adding the card.",
          );
        const intent = await ownersRef.current.service.prepareCreate(
          source,
          expected,
          draft,
        );
        if (!alive.current || current !== version.current) return;
        held.current = intent;
        await commit(intent);
      });
    } catch (failure) {
      if (alive.current && current === version.current)
        setError(message(failure));
    } finally {
      if (alive.current && current === version.current) {
        pending.current = false;
        setBusy(false);
      }
    }
  }
  async function reload() {
    const current = version.current,
      intent = held.current;
    pending.current = true;
    setBusy(true);
    try {
      const expected = await trackOperation(() => tokens(ownersRef.current));
      if (
        alive.current &&
        current === version.current &&
        intent === held.current
      ) {
        if (expected.library.epoch !== selection?.libraryEpoch)
          throw new Error("The workspace changed. Select the passage again.");
        setReloaded(true);
      }
    } catch (failure) {
      if (alive.current && current === version.current)
        setError(message(failure));
    } finally {
      if (alive.current && current === version.current) {
        pending.current = false;
        setBusy(false);
      }
    }
  }
  async function retry() {
    if (!held.current || pending.current || !reloaded || conflict) return;
    pending.current = true;
    setBusy(true);
    try {
      await trackOperation(() => commit(held.current!));
    } finally {
      if (alive.current) {
        pending.current = false;
        setBusy(false);
      }
    }
  }
  function edit(action: () => void) {
    if (closingRef.current || pending.current || held.current) return;
    dirty.current = true;
    action();
    setError("");
  }
  if (hidden) return null;
  return (
    <>
      <div
        ref={root}
        role="dialog"
        aria-label="Make a card"
        inert={closing}
        aria-hidden={closing || undefined}
        className={`source-card-popover${sheet ? " source-card-sheet" : ""}${closing ? " source-closing" : ""}`}
        style={position}
        onKeyDown={(event) => {
          if (closingRef.current) {
            event.preventDefault();
            event.stopPropagation();
            return;
          }
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            cancel();
          }
          if (event.key === "Tab") {
            const controls = Array.from(
                root.current?.querySelectorAll<HTMLElement>(
                  "button:not(:disabled),textarea:not(:disabled),select:not(:disabled),input:not(:disabled)",
                ) ?? [],
              ),
              first = controls[0],
              last = controls.at(-1);
            if (event.shiftKey && document.activeElement === first) {
              event.preventDefault();
              last?.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault();
              first?.focus();
            }
          }
        }}
      >
        <h2>Make a card</h2>
        <div
          className="source-card-types"
          role="group"
          aria-label="Card type"
          onKeyDown={(event) => {
            if (
              !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key) ||
              pending.current ||
              held.current ||
              closingRef.current
            )
              return;
            const options = Array.from(
              event.currentTarget.querySelectorAll<HTMLButtonElement>(
                "button:not(:disabled)",
              ),
            );
            if (!options.length || !(event.target instanceof HTMLButtonElement))
              return;
            const index = options.indexOf(event.target),
              next =
                event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? options.length - 1
                    : event.key === "ArrowRight"
                      ? (index + 1) % options.length
                      : (index - 1 + options.length) % options.length;
            event.preventDefault();
            event.stopPropagation();
            options[next]?.focus();
            options[next]?.click();
          }}
        >
          {(
            [
              ["basic", "Basic"],
              ["reversed", "Reversed"],
              ["cloze", "Fill in the blank"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              aria-pressed={type === value}
              disabled={
                busy ||
                !!held.current ||
                (value === "cloze" && clozeUnavailable)
              }
              onClick={() => edit(() => setType(value))}
            >
              {label}
            </button>
          ))}
        </div>
        {type !== "cloze" && (
          <>
            <label>
              Front
              <textarea
                value={front}
                placeholder="Write the question"
                rows={3}
                disabled={busy || !!held.current}
                onChange={(event) => edit(() => setFront(event.target.value))}
              />
            </label>
            <label>
              Back
              <textarea
                value={back}
                rows={3}
                disabled={busy || !!held.current}
                onChange={(event) => edit(() => setBack(event.target.value))}
              />
            </label>
          </>
        )}
        <label>
          Deck
          <select
            value={deckId}
            disabled={busy || !!held.current}
            onChange={(event) => edit(() => setDeckId(event.target.value))}
          >
            <option value="">Choose a deck</option>
            {decks.map((deck) => (
              <option key={deck.id} value={deck.id}>
                {deck.title}
              </option>
            ))}
          </select>
        </label>
        {!decks.length && selection && (
          <p>Create a deck in Study before adding a card.</p>
        )}
        <section className="source-card-preview" aria-label="Card preview">
          <small>Preview</small>
          {type === "cloze" ? (
            <>
              <p>
                {context.text.slice(0, context.selectionFrom)}
                <b>[...]</b>
                {context.text.slice(context.selectionTo)}
              </p>
              <p>Answer: {capture.selection.passage.quote}</p>
            </>
          ) : (
            <>
              <p>{front || "Write the question"}</p>
              <hr />
              <p>{back}</p>
              {type === "reversed" && (
                <>
                  <hr />
                  <p>{back}</p>
                  <hr />
                  <p>{front || "Write the question"}</p>
                  <small>Creates 2 cards with separate schedules.</small>
                </>
              )}
            </>
          )}
        </section>
        <p>Linked to this note, so you can jump back to the passage.</p>
        {!selection && !barrierError && !unavailable && (
          <p role="status">Saving the selected note…</p>
        )}
        {barrierError && (
          <div role="alert">
            <p>{barrierError}</p>
            <button
              disabled={busy}
              onClick={() => setAttempt((value) => value + 1)}
            >
              Retry saving note
            </button>
            <button disabled={busy || !!held.current} onClick={onReselect}>
              Return to note and keep card draft
            </button>
          </div>
        )}
        {unavailable && (
          <div role="status">
            <p>This passage changed. Select it again before adding the card.</p>
            <button disabled={busy || !!held.current} onClick={onReselect}>
              Select passage again
            </button>
          </div>
        )}
        {clozeUnavailable && (
          <p>
            Blank markers in this context prevent a new blank. Use Basic or
            Reversed, or select a different passage.
          </p>
        )}
        {error && (
          <div role="alert" className="error">
            <p>{error}</p>
            {held.current && (
              <>
                <button disabled={busy} onClick={() => void reload()}>
                  Reload saved data
                </button>
                {conflict ? (
                  <button
                    disabled={busy || !reloaded}
                    onClick={() => {
                      if (pending.current) return;
                      held.current = null;
                      setError("");
                      setConflict(false);
                      setSelection(null);
                      setAttempt((value) => value + 1);
                    }}
                  >
                    Keep draft and clear action
                  </button>
                ) : (
                  <button
                    disabled={busy || !reloaded}
                    onClick={() => void retry()}
                  >
                    Retry same action
                  </button>
                )}
              </>
            )}
          </div>
        )}
        {notice && <p role="status">{notice}</p>}
        <div className="actions">
          <button disabled={busy} onClick={cancel}>
            Cancel
          </button>
          <button
            className="primary"
            disabled={
              busy ||
              !!held.current ||
              !selection ||
              unavailable ||
              !deckId ||
              (type !== "cloze" && (!front.trim() || !back.trim())) ||
              (type === "cloze" && clozeUnavailable)
            }
            onClick={() => void add()}
          >
            {busy ? "Adding…" : "Add card"}
          </button>
        </div>
      </div>
      {discard && (
        <Dialog
          title="Discard card draft?"
          onClose={() => {
            if (!pending.current) setDiscard(false);
          }}
        >
          <p>
            Your unsubmitted card fields will be lost.
            {held.current &&
              " The earlier result is unconfirmed; a card may already have been added. This does not delete a saved card."}
          </p>
          <button
            disabled={busy}
            onClick={() => {
              if (!pending.current) setDiscard(false);
            }}
          >
            Keep editing
          </button>
          <button
            className="danger"
            disabled={busy}
            onClick={() => {
              if (pending.current) return;
              held.current = null;
              dirty.current = false;
              setDiscard(false);
              beginExit(() => closeRef.current(true));
            }}
          >
            Discard card draft
          </button>
        </Dialog>
      )}
    </>
  );
}
export function SourceCardNotice({
  owners,
  result,
  onClose,
  onOpen,
}: {
  owners: SourceCardOwners;
  result: MakeCardResult;
  onClose: () => void;
  onOpen: (entryId: string) => void;
}) {
  const node = useRef<HTMLDivElement>(null),
    closingRef = useRef(false);
  const [closing, setClosing] = useState(false);
  const [undone, setUndone] = useState(false);
  function beginNoticeExit() {
    if (closingRef.current) return;
    closingRef.current = true;
    setClosing(true);
  }
  function dismiss() {
    if (pending.current || held.current) return;
    beginNoticeExit();
  }
  const [clock, setClock] = useState(Date.now()),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [reloaded, setReloaded] = useState(false),
    [conflict, setConflict] = useState(false),
    [paused, setPaused] = useState(false);
  const alive = useRef(true),
    generation = useRef(0),
    pending = useRef(false),
    held = useRef<UndoMakeCardIntent | null>(null),
    remaining = useRef(5000);
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {
      if (pending.current || held.current) event.preventDefault();
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, []);
  useLayoutEffect(() => {
    if (!closing) return;
    const element = node.current,
      ticket = generation.current;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      if (alive.current && ticket === generation.current) onClose();
    };
    const end = (event: AnimationEvent) => {
      if (isExitEnd(event, element, "source-toast-out")) finish();
    };
    element?.addEventListener("animationend", end);
    const timer = setTimeout(finish, exitDuration(element) + 34);
    return () => {
      clearTimeout(timer);
      element?.removeEventListener("animationend", end);
    };
  }, [closing]);
  const [destination, setDestination] = useState<string | null>(null);
  useEffect(() => {
    let active = true,
      sequence = 0;
    const ticket = generation.current;
    setDestination(null);
    const read = () => {
      const request = ++sequence;
      void owners.collections
        .read()
        .then((value) => {
          if (
            !active ||
            !alive.current ||
            ticket !== generation.current ||
            request !== sequence
          )
            return;
          if (value.epoch !== result.tokens.collections.epoch) {
            setDestination(null);
            return;
          }
          const entry = value.study.entries.find(
              (entry) => entry.id === result.entryId,
            ),
            deck = entry
              ? value.study.decks.find((deck) => deck.id === entry.deckId)
              : undefined;
          setDestination(deck?.title ?? null);
        })
        .catch(() => {
          if (
            active &&
            alive.current &&
            ticket === generation.current &&
            request === sequence
          )
            setDestination(null);
        });
    };
    const stop = owners.collections.subscribe(read);
    read();
    return () => {
      active = false;
      sequence++;
      stop();
    };
  }, [owners.collections, result.entryId, result.tokens.collections.epoch]);
  const canUndo =
    !undone &&
    clock >= Date.parse(result.receipt.at) &&
    clock < Date.parse(result.receipt.at) + 5000;
  useLayoutEffect(() => {
    alive.current = true;
    const stop = owners.service.onInvalidate(() => {
      generation.current++;
      held.current = null;
      pending.current = false;
      if (alive.current) flushSync(onClose);
    });
    return () => {
      alive.current = false;
      generation.current++;
      stop();
    };
  }, [owners.service]);
  useLayoutEffect(
    () => registerCloseGuard(() => !pending.current && !held.current),
    [],
  );
  useEffect(() => {
    const expire = setTimeout(
      () => setClock(Date.now()),
      Math.max(0, Date.parse(result.receipt.at) + 5001 - Date.now()),
    );
    return () => clearTimeout(expire);
  }, [result]);
  useEffect(() => {
    if (paused || busy || held.current || closing) return;
    const started = Date.now();
    const timer = setTimeout(dismiss, remaining.current);
    return () => {
      clearTimeout(timer);
      remaining.current = Math.max(
        0,
        remaining.current - (Date.now() - started),
      );
    };
  }, [paused, busy, result, closing, error]);
  async function commit(intent: UndoMakeCardIntent) {
    const ticket = generation.current;
    try {
      await owners.service.commit(intent);
      if (alive.current && ticket === generation.current) {
        held.current = null;
        setUndone(true);
        beginNoticeExit();
      }
    } catch (failure) {
      if (alive.current && ticket === generation.current) {
        setError(message(failure));
        setConflict(!!conflictCode(failure));
        setReloaded(false);
      }
    }
  }
  async function undo() {
    if (closingRef.current || pending.current || held.current) return;
    if (
      Date.now() < Date.parse(result.receipt.at) ||
      Date.now() >= Date.parse(result.receipt.at) + 5000
    ) {
      setClock(Date.now());
      setError("Undo is no longer available.");
      return;
    }
    const ticket = generation.current;
    pending.current = true;
    setBusy(true);
    try {
      await trackOperation(async () => {
        const expected = await tokens(owners);
        if (!alive.current || ticket !== generation.current) return;
        const intent = await owners.service.prepareUndo(
          expected,
          result.receipt.operationId,
        );
        if (!alive.current || ticket !== generation.current) return;
        held.current = intent;
        await commit(intent);
      });
    } catch (failure) {
      if (alive.current && ticket === generation.current)
        setError(message(failure));
    } finally {
      if (alive.current && ticket === generation.current) {
        pending.current = false;
        setBusy(false);
      }
    }
  }
  async function reload() {
    const ticket = generation.current,
      intent = held.current;
    try {
      await trackOperation(() => tokens(owners));
      if (
        alive.current &&
        ticket === generation.current &&
        intent === held.current
      )
        setReloaded(true);
    } catch (failure) {
      if (alive.current && ticket === generation.current)
        setError(message(failure));
    }
  }
  return (
    <div
      ref={node}
      className={
        closing ? "source-card-notice source-closing" : "source-card-notice"
      }
      role="status"
      inert={closing}
      aria-hidden={closing || undefined}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node))
          setPaused(false);
      }}
    >
      <span>
        {undone
          ? "Card creation undone"
          : result.cardIds.length === 2
            ? `2 cards added${destination ? ` to ${destination}` : ""}`
            : `Card added${destination ? ` to ${destination}` : ""}`}
      </span>
      <button
        aria-label="Undo card creation"
        aria-disabled={!canUndo || busy || !!held.current}
        onClick={() => {
          if (canUndo && !busy && !held.current) void undo();
        }}
      >
        Undo
      </button>
      <button
        disabled={busy || !!held.current}
        onClick={() => {
          if (!closingRef.current && !pending.current && !held.current)
            onOpen(result.entryId);
        }}
      >
        Open card
      </button>
      <button
        aria-label="Dismiss card notification"
        disabled={busy || !!held.current}
        onClick={dismiss}
      >
        ×
      </button>
      {error && (
        <div role="alert">
          <p>{error}</p>
          {held.current && (
            <>
              <button disabled={busy} onClick={() => void reload()}>
                Reload saved data
              </button>
              {conflict ? (
                <button
                  disabled={!reloaded || busy}
                  onClick={() => {
                    held.current = null;
                    setError("");
                  }}
                >
                  Clear unavailable Undo
                </button>
              ) : (
                <button
                  disabled={!reloaded || busy}
                  onClick={() => {
                    if (!held.current || pending.current) return;
                    pending.current = true;
                    setBusy(true);
                    void trackOperation(() => commit(held.current!)).finally(
                      () => {
                        if (alive.current) {
                          pending.current = false;
                          setBusy(false);
                        }
                      },
                    );
                  }}
                >
                  Retry same Undo
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
