import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { registerCloseGuard } from "../desktop/closeGuard";
import { confirmedTagPrefix, formatTagText, parseTagText } from "./tagText";
import "../styles/note-metadata.css";
import "../styles/compact-note-tags.css";
export function CompactNoteTags({
  tags,
  onChange,
  onPendingChange,
  onApply,
  readOnly = false,
  children,
}: {
  tags: string[];
  onChange: (tags: string[]) => void;
  onPendingChange?: (pending: boolean) => void;
  onApply?: () => void;
  readOnly?: boolean;
  children?: ReactNode;
}) {
  const [editing, setEditing] = useState(false),
    [value, setValue] = useState(""),
    [error, setError] = useState(""),
    [confirmed, setConfirmed] = useState<string[]>([]);
  const input = useRef<HTMLInputElement>(null),
    trigger = useRef<HTMLButtonElement>(null),
    snapshot = useRef<string[]>([]);
  const pending = useRef(false),
    open = useRef(false),
    composing = useRef(false),
    tokenized = useRef(false),
    confirmedRef = useRef<string[]>([]);
  const callbacks = useRef({ onChange, onPendingChange, onApply });
  callbacks.current = { onChange, onPendingChange, onApply };
  const id = useId();
  function mark(next: boolean) {
    pending.current = next;
    callbacks.current.onPendingChange?.(next);
  }
  useEffect(() => {
    if (editing) input.current?.focus({ preventScroll: true });
  }, [editing]);
  useEffect(() => {
    const stop = registerCloseGuard(() => {
      if (pending.current) input.current?.focus({ preventScroll: true });
      return !pending.current;
    });
    const unload = (event: BeforeUnloadEvent) => {
      if (pending.current) event.preventDefault();
    };
    window.addEventListener("beforeunload", unload);
    return () => {
      stop();
      window.removeEventListener("beforeunload", unload);
      callbacks.current.onPendingChange?.(false);
    };
  }, []);
  function start() {
    if (readOnly) return;
    // Single-line HTML inputs strip CR/LF. Never rewrite a legacy tag identity.
    if (tags.some((tag) => /[\r\n]/.test(tag))) {
      setError(
        "A tag contains a line break. Rename it in Tags before editing this list.",
      );
      return;
    }
    snapshot.current = [...tags];
    tokenized.current = false;
    confirmedRef.current = [];
    setConfirmed([]);
    setValue(formatTagText(tags));
    setError("");
    mark(false);
    open.current = true;
    setEditing(true);
  }
  function finish(commit: boolean) {
    if (!open.current || composing.current) return;
    if (commit && pending.current) {
      if (readOnly) {
        setError("This note is read-only. Your tag edit is still here.");
        return;
      }
      if (JSON.stringify(tags) !== JSON.stringify(snapshot.current)) {
        setError(
          "Tags changed while you were editing. Cancel with Escape and try again.",
        );
        return;
      }
      try {
        const rest = parseTagText(value);
        const next = tokenized.current
          ? parseTagText(formatTagText([...confirmedRef.current, ...rest]))
          : rest;
        if (JSON.stringify(next) !== JSON.stringify(tags))
          callbacks.current.onChange(next);
      } catch (failure) {
        setError(
          failure instanceof Error
            ? failure.message
            : "Couldn’t apply tags. Your edit is still here.",
        );
        return;
      }
    }
    open.current = false;
    mark(false);
    setError("");
    setEditing(false);
  }
  function edit(nextValue: string) {
    setError("");
    const prefix = composing.current
      ? null
      : confirmedTagPrefix(value, nextValue);
    if (prefix) {
      try {
        if (readOnly)
          throw Error("This note is read-only. Your tag edit is still here.");
        if (JSON.stringify(tags) !== JSON.stringify(snapshot.current))
          throw Error(
            "Tags changed while you were editing. Cancel with Escape and try again.",
          );
        const names = parseTagText(prefix.text);
        const next = parseTagText(
          formatTagText([...confirmedRef.current, ...names]),
        );
        if (JSON.stringify(next) !== JSON.stringify(tags))
          callbacks.current.onChange(next);
        snapshot.current = [...next];
        tokenized.current = true;
        confirmedRef.current = next;
        setConfirmed(next);
        setValue(prefix.rest);
        mark(prefix.rest.length > 0);
        return;
      } catch (failure) {
        setError(
          failure instanceof Error
            ? failure.message
            : "Couldn’t apply tags. Your edit is still here.",
        );
      }
    }
    setValue(nextValue);
    mark(
      tokenized.current
        ? nextValue.length > 0
        : nextValue !== formatTagText(snapshot.current),
    );
  }
  return (
    <div className="compact-note-tags">
      <div className="note-metadata compact-note-metadata">
        <button
          ref={trigger}
          type="button"
          className="compact-tags-hash"
          aria-label="Manage note tags"
          aria-expanded={editing}
          aria-controls={id}
          disabled={readOnly}
          title={tags.length ? "Edit tags" : "Add tags"}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => (editing ? finish(true) : start())}
        >
          #
        </button>
        {editing && confirmed.length > 0 && (
          <span className="compact-tags-confirmed" aria-label="Confirmed tags">
            {confirmed.join(", ")}
            <span aria-hidden="true">,</span>
          </span>
        )}
        {editing ? (
          <input
            ref={input}
            id={id}
            className="compact-tags-input"
            aria-label="Tags, separated by commas"
            aria-invalid={!!error}
            aria-describedby={error ? `${id}-error` : undefined}
            readOnly={readOnly}
            value={value}
            placeholder={
              tokenized.current ? "Next tag" : "trip, planning, ideas"
            }
            maxLength={24000}
            onChange={(event) => edit(event.target.value)}
            onBlur={() => finish(true)}
            onCompositionStart={() => {
              composing.current = true;
            }}
            onCompositionEnd={() => {
              composing.current = false;
            }}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing || composing.current) return;
              if (
                event.key === "Enter" ||
                event.key === "Escape" ||
                (event.key === "Tab" && !event.shiftKey)
              ) {
                event.preventDefault();
                event.stopPropagation();
                const cancel = event.key === "Escape";
                finish(!cancel);
                if (cancel) trigger.current?.focus({ preventScroll: true });
                else if (!open.current) {
                  if (callbacks.current.onApply) callbacks.current.onApply();
                  else trigger.current?.focus({ preventScroll: true });
                }
              }
            }}
          />
        ) : tags.length ? (
          <button
            type="button"
            className="compact-tags-text"
            aria-label="Current note tags"
            disabled={readOnly}
            onClick={start}
          >
            {tags.join(", ")}
          </button>
        ) : null}
        {children}
      </div>
      {error && (
        <p className="compact-tags-error" role="alert" id={`${id}-error`}>
          {error}
        </p>
      )}
    </div>
  );
}
