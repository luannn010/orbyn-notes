import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type {
  LinkCandidate,
  LinkSearchCursor,
  NoteTarget,
} from "../links/contracts";
import type { EditorNoteLinks } from "./noteLinkViews";
import "../styles/note-links.css";
import { registerCloseGuard, trackOperation } from "../desktop/closeGuard";
export function NoteLinkPicker({
  owner,
  query: inlineQuery,
  anchor,
  isCurrent,
  onChoose,
  onClose,
  onQuery,
}: {
  owner: EditorNoteLinks;
  query?: string;
  anchor: () => DOMRect;
  isCurrent: () => boolean;
  onChoose: (target: NoteTarget) => void;
  onClose: (restoreFocus?: boolean) => void;
  onQuery?: (query: string) => void;
}) {
  const [closing, setClosing] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const closingRef = useRef(false);
  const restoreFocus = useRef(true);
  function finish(restore = true) {
    if (closingRef.current) return;
    restoreFocus.current = restore;
    closingRef.current = true;
    setClosing(true);
  }
  const [query, setQuery] = useState(inlineQuery ?? ""),
    [items, setItems] = useState<LinkCandidate[]>([]),
    [next, setNext] = useState<LinkSearchCursor | null>(null),
    [active, setActive] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [position, setPosition] = useState<React.CSSProperties>({
      visibility: "hidden",
    });
  const root = useRef<HTMLDivElement>(null),
    sequence = useRef(0),
    alive = useRef(true),
    pending = useRef(false),
    composing = useRef(false),
    cursor = useRef<LinkSearchCursor | null>(null),
    token = useRef("");
  useEffect(() => registerCloseGuard(() => !pending.current), []);
  const current = useRef({ isCurrent, onChoose, onClose });
  current.current = { isCurrent, onChoose, onClose };
  useEffect(() => {
    if (inlineQuery !== undefined) setQuery(inlineQuery);
  }, [inlineQuery]);
  useEffect(() => {
    alive.current = true;
    const stop = owner.service.onInvalidate(() => {
      sequence.current++;
      current.current.onClose(false);
    });
    return () => {
      alive.current = false;
      sequence.current++;
      stop();
    };
  }, [owner.service]);
  useEffect(() => {
    if (!closing) return;
    const element = root.current;
    let done = false;
    const end = () => {
      if (done) return;
      done = true;
      if (alive.current) current.current.onClose(restoreFocus.current);
    };
    const listener = (event: AnimationEvent) => {
      if (event.target === element) end();
    };
    element?.addEventListener("animationend", listener);
    const css = element ? getComputedStyle(element) : null;
    const duration = Math.max(
      ...(css?.animationDuration ?? "0s")
        .split(",")
        .map((value) => parseFloat(value) * 1000),
      0,
    );
    const timer = setTimeout(end, duration + 34);
    return () => {
      clearTimeout(timer);
      element?.removeEventListener("animationend", listener);
    };
  }, [closing]);
  async function read(more = false) {
    const ticket = ++sequence.current;
    setBusy(true);
    setError("");
    setPreparing(false);
    if (!more) {
      setItems([]);
      setNext(null);
      cursor.current = null;
      setActive(0);
    }
    if (query.length > 200) {
      setError("Search with 200 characters or fewer.");
      setBusy(false);
      return;
    }
    try {
      const admission = await owner.service.admission();
      if (admission.mode === "index-recovery")
        throw Error("Repair note links before adding a reference.");
      if (admission.mode === "legacy" && admission.premise !== "verified") {
        if (alive.current && ticket === sequence.current) setPreparing(true);
        throw Error(
          "Preparing note links. Continue to check the remaining notes.",
        );
      }
      const result = await owner.service.search(
        query,
        owner.noteId,
        more ? (cursor.current ?? undefined) : undefined,
      );
      if (!alive.current || ticket !== sequence.current) return;
      const key = JSON.stringify(result.token);
      if (more && token.current !== key)
        throw Error("Notes changed. Search again.");
      token.current = key;
      cursor.current = result.next;
      setNext(result.next);
      setItems((old) => (more ? [...old, ...result.items] : result.items));
    } catch (failure) {
      if (alive.current && ticket === sequence.current)
        setError(
          failure instanceof Error
            ? failure.message
            : "Couldn’t load notes. Try again.",
        );
    } finally {
      if (alive.current && ticket === sequence.current) setBusy(false);
    }
  }
  useEffect(() => {
    void read();
    const stop = owner.service.subscribe(() => void read());
    return () => {
      sequence.current++;
      stop();
    };
  }, [owner.service, owner.noteId, query]);
  useLayoutEffect(() => {
    const place = () => {
      const node = root.current;
      if (!node) return;
      const r = anchor(),
        v = window.visualViewport,
        left = v?.offsetLeft ?? 0,
        top = v?.offsetTop ?? 0,
        w = v?.width ?? innerWidth,
        h = v?.height ?? innerHeight;
      const pane = node.ownerDocument
        .querySelector(".editor-pane")
        ?.getBoundingClientRect();
      const narrow = Math.min(w, pane?.width ?? w) < 416;
      const paneLeft = pane?.width ? Math.max(left, pane.left) : left,
        paneRight = pane?.width ? Math.min(left + w, pane.right) : left + w;
      setSheet(narrow);
      setPosition({
        position: "fixed",
        width: narrow
          ? Math.max(1, paneRight - paneLeft)
          : Math.min(400, w - 16),
        left: narrow
          ? paneLeft
          : Math.max(left + 8, Math.min(r.left, left + w - 408)),
        top: narrow
          ? undefined
          : Math.max(top + 8, Math.min(r.bottom + 4, top + h - 180)),
        maxHeight: narrow
          ? h - 8
          : Math.max(120, top + h - Math.max(top + 8, r.bottom + 4) - 8),
        bottom: narrow ? Math.max(0, innerHeight - top - h) : undefined,
      });
    };
    place();
    const pane = document.querySelector(".editor-pane"),
      observer =
        typeof ResizeObserver !== "undefined"
          ? new ResizeObserver(place)
          : null;
    if (pane) observer?.observe(pane);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    const v = window.visualViewport;
    v?.addEventListener("resize", place);
    v?.addEventListener("scroll", place);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      v?.removeEventListener("resize", place);
      v?.removeEventListener("scroll", place);
    };
  }, [anchor]);
  async function choose(item: LinkCandidate) {
    if (pending.current || closingRef.current) return;
    if (!current.current.isCurrent()) {
      setError("This insertion point changed. Choose where to link again.");
      return;
    }
    pending.current = true;
    setBusy(true);
    const ticket = sequence.current;
    try {
      const result = await owner.service.reference(item.target.noteId);
      if (!alive.current || ticket !== sequence.current) return;
      if (
        !current.current.isCurrent() ||
        JSON.stringify(result.target) !== JSON.stringify(item.target)
      )
        throw Error(
          "This insertion point changed. Choose where to link again.",
        );
      current.current.onChoose(item.target);
      finish();
    } catch (failure) {
      if (alive.current && ticket === sequence.current)
        setError(
          failure instanceof Error
            ? failure.message
            : "Couldn’t link this note. Try again.",
        );
    } finally {
      pending.current = false;
      if (alive.current) setBusy(false);
    }
  }
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (!pending.current && !root.current?.contains(event.target as Node))
        finish(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, []);
  useEffect(() => {
    root.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [active]);
  return createPortal(
    <div
      ref={root}
      className="note-link-picker"
      data-exiting={closing || undefined}
      data-sheet={sheet || undefined}
      inert={closing}
      role="dialog"
      aria-label="Link picker"
      style={position}
      onKeyDown={(event) => {
        if (composing.current || event.nativeEvent.isComposing) return;
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          if (!pending.current) finish();
        } else if (event.key === "Tab") {
          if (!pending.current) finish(false);
        } else if (
          ["ArrowUp", "ArrowDown"].includes(event.key) &&
          items.length
        ) {
          event.preventDefault();
          setActive(
            (old) =>
              (old + (event.key === "ArrowDown" ? 1 : -1) + items.length) %
              items.length,
          );
        } else if (event.key === "Enter") {
          event.preventDefault();
          if (items[active] && !busy) void choose(items[active]);
        }
      }}
    >
      <div className="note-link-picker-head">
        <input
          autoFocus
          aria-label="Search notes to link"
          placeholder="Search notes"
          role="combobox"
          aria-expanded="true"
          aria-controls="note-link-options"
          aria-activedescendant={
            items[active] ? `note-link-option-${active}` : undefined
          }
          value={query}
          readOnly={pending.current}
          onChange={(event) => {
            if (onQuery) onQuery(event.target.value);
            else setQuery(event.target.value);
          }}
          onCompositionStart={() => {
            composing.current = true;
          }}
          onCompositionEnd={() => {
            composing.current = false;
          }}
        />
        <button
          type="button"
          aria-label="Close link picker"
          disabled={pending.current}
          onClick={() => {
            if (!pending.current) finish();
          }}
        >
          ×
        </button>
      </div>
      <div className="note-link-group">Notes</div>
      <div role="listbox" id="note-link-options" aria-label="Notes to link">
        {items.map((item, index) => (
          <button
            type="button"
            role="option"
            id={`note-link-option-${index}`}
            aria-selected={active === index}
            key={JSON.stringify(item.target)}
            disabled={busy}
            onPointerMove={() => setActive(index)}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => void choose(item)}
          >
            <span>{item.title || "Untitled note"}</span>
            <small>
              {item.thisNote
                ? "This note"
                : new Date(item.updatedAt).toLocaleDateString()}
            </small>
          </button>
        ))}
      </div>
      {busy && <p role="status">Searching notes…</p>}
      {error && (
        <p role={preparing ? "status" : "alert"}>
          {error}{" "}
          <button
            type="button"
            disabled={pending.current}
            onClick={() => {
              if (!preparing) {
                void read();
                return;
              }
              if (pending.current) return;
              pending.current = true;
              setBusy(true);
              void trackOperation(() => owner.service.verifyGraph())
                .then(() => {
                  if (alive.current) void read();
                })
                .catch(() => {
                  if (alive.current)
                    setError("Couldn’t prepare note links. Try again.");
                })
                .finally(() => {
                  pending.current = false;
                  if (alive.current) setBusy(false);
                });
            }}
          >
            {preparing ? "Continue preparation" : "Retry"}
          </button>
        </p>
      )}
      {!busy && !error && !items.length && (
        <p role="status">No matching notes</p>
      )}
      {next && (
        <button type="button" disabled={busy} onClick={() => void read(true)}>
          More notes
        </button>
      )}
      <p className="note-link-hint">↑ ↓ to move · ⏎ to link · Esc to close</p>
    </div>,
    document.body,
  );
}
