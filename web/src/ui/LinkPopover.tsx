import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { registerCloseGuard } from "../desktop/closeGuard";
import { safeLink } from "./model";

export function LinkPopover({
  initialUrl,
  originalUrl = initialUrl,
  onChange,
  unavailable,
  onLock,
  anchor,
  onApply,
  onRemove,
  onCancel,
}: {
  initialUrl: string;
  originalUrl?: string;
  onChange?: (url: string) => void;
  unavailable?: string;
  onLock?: () => void;
  anchor: () => { left: number; top: number; bottom: number };
  onApply: (url: string) => string | null;
  onRemove?: () => string | null;
  onCancel: (restoreFocus: boolean) => void;
}) {
  const [url, setUrl] = useState(initialUrl),
    [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [position, setPosition] = useState({ left: 8, top: 8 });
  const root = useRef<HTMLFormElement>(null),
    input = useRef<HTMLInputElement>(null);
  const dirty = useRef(initialUrl !== originalUrl),
    anchorRef = useRef(anchor),
    cancelRef = useRef(onCancel);
  anchorRef.current = anchor;
  cancelRef.current = onCancel;
  const id = useId();
  useLayoutEffect(
    () =>
      registerCloseGuard(() => {
        if (!dirty.current) return true;
        setNotice("Apply or cancel this link before leaving.");
        return false;
      }),
    [],
  );
  useLayoutEffect(() => {
    const place = () => {
      try {
        const rect = anchorRef.current(),
          height = root.current?.offsetHeight ?? 180,
          width = root.current?.offsetWidth ?? 320;
        const below = innerHeight - rect.bottom - 8;
        setPosition({
          left: Math.max(8, Math.min(rect.left, innerWidth - width - 8)),
          top: Math.max(
            8,
            Math.min(
              below >= height ? rect.bottom + 6 : rect.top - height - 6,
              innerHeight - height - 8,
            ),
          ),
        });
      } catch {
        setPosition({ left: 8, top: 8 });
      }
    };
    place();
    input.current?.focus();
    input.current?.select();
    const resize =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(place);
    if (root.current) resize?.observe(root.current);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      resize?.disconnect();
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, []);
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (root.current?.contains(event.target as Node)) return;
      if (
        event.target instanceof Element &&
        event.target.closest('[data-preserves-editor-draft="true"]')
      )
        return;
      if (dirty.current) setNotice("Apply or cancel this link before leaving.");
      else cancelRef.current(false);
    };
    const outsideClick = (event: MouseEvent) => {
      if (root.current?.contains(event.target as Node)) return;
      if (
        event.target instanceof Element &&
        event.target.closest('[data-preserves-editor-draft="true"]')
      )
        return;
      if (!dirty.current) {
        cancelRef.current(false);
        return;
      }
      // Preserve the form/guard before route or caption handlers can close it.
      event.preventDefault();
      event.stopPropagation();
      setNotice("Apply or cancel this link before leaving.");
      input.current?.focus();
    };
    const unload = (event: BeforeUnloadEvent) => {
      if (dirty.current) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("click", outsideClick, true);
    window.addEventListener("beforeunload", unload);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("click", outsideClick, true);
      window.removeEventListener("beforeunload", unload);
    };
  }, []);
  return (
    <form
      ref={root}
      className="link-popover"
      role="dialog"
      aria-label="Web link"
      style={position}
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        event.stopPropagation();
        if (unavailable) return;
        const value = url.trim();
        if (!safeLink(value)) {
          setError("Enter a valid web or email link.");
          return;
        }
        const failure = onApply(value);
        if (failure) setError(failure);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          onCancel(true);
        }
        if (event.key === "Tab") {
          const controls = Array.from(
            root.current?.querySelectorAll<HTMLElement>(
              "input,button:not(:disabled)",
            ) ?? [],
          );
          const first = controls[0],
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
      <b>Web link</b>
      <label htmlFor={id}>URL</label>
      <input
        id={id}
        ref={input}
        inputMode="url"
        autoComplete="off"
        spellCheck={false}
        value={url}
        aria-describedby={`${id}-hint`}
        aria-invalid={!!error}
        onChange={(event) => {
          try {
            onChange?.(event.target.value);
          } catch (failure) {
            setError(
              failure instanceof Error
                ? failure.message
                : "Could not retain this link draft.",
            );
            return;
          }
          dirty.current = event.target.value !== originalUrl;
          setUrl(event.target.value);
          setError("");
          setNotice("");
        }}
      />
      <small id={`${id}-hint`}>https://, http:// or mailto:</small>
      {unavailable && <p role="status">{unavailable}</p>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      <div className="link-popover-actions">
        {onRemove && (
          <button
            type="button"
            disabled={!!unavailable}
            onClick={() => {
              const failure = onRemove();
              if (failure) setError(failure);
            }}
          >
            Remove link
          </button>
        )}
        <button type="button" onClick={() => onCancel(true)}>
          Cancel
        </button>
        <button type="submit" className="primary" disabled={!!unavailable}>
          Apply link
        </button>
      </div>
      {onLock && (
        <div className="link-popover-lock">
          <button type="button" onClick={onLock}>
            Lock Journal
          </button>
          <small>Your unfinished link will be kept for unlock.</small>
        </div>
      )}
    </form>
  );
}
