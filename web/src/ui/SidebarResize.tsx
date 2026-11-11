import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

export const SIDEBAR_MIN = 180;
export const SIDEBAR_MAX = 420;
export const SIDEBAR_DEFAULT = 224;
const WIDTH_KEY = "notes.sidebar-width";

function validWidth(value: number) {
  return Number.isFinite(value) && value >= SIDEBAR_MIN && value <= SIDEBAR_MAX;
}
function clamp(value: number) {
  return Math.round(Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, value)));
}

/** Device-local presentation preference; unavailable storage leaves resizing usable. */
export function useSidebarWidth() {
  const [width, setWidth] = useState(() => {
    try {
      const raw = localStorage.getItem(WIDTH_KEY);
      const value = raw === null || raw.trim() === "" ? NaN : Number(raw);
      return validWidth(value) ? clamp(value) : SIDEBAR_DEFAULT;
    } catch {
      /* Optional storage cannot prevent rendering. */
    }
    return SIDEBAR_DEFAULT;
  });
  const changeWidth = useCallback((value: number) => {
    if (!Number.isFinite(value)) return;
    const next = clamp(value);
    setWidth(next);
    try {
      localStorage.setItem(WIDTH_KEY, String(next));
    } catch {
      /* Optional preference. */
    }
  }, []);
  return [width, changeWidth] as const;
}

export function SidebarResize({
  value,
  onChange,
  controls = "notes-sidebar",
  disabled = false,
}: {
  value: number;
  onChange: (value: number) => void;
  controls?: string;
  disabled?: boolean;
}) {
  const rail = useRef<HTMLDivElement>(null);
  const active = useRef<{
    id: number;
    x: number;
    width: number;
    element: HTMLDivElement;
  } | null>(null);
  const [dragging, setDragging] = useState(false);
  const current = useRef({ disabled, onChange });
  current.current = { disabled, onChange };
  const width = validWidth(value) ? clamp(value) : SIDEBAR_DEFAULT;

  const release = useCallback(() => {
    const pointer = active.current;
    active.current = null;
    if (pointer?.element.hasPointerCapture?.(pointer.id)) {
      pointer.element.releasePointerCapture(pointer.id);
    }
  }, []);
  const stop = useCallback(() => {
    release();
    setDragging(false);
  }, [release]);
  useLayoutEffect(() => {
    if (disabled) stop();
  }, [disabled, stop]);
  useEffect(() => {
    window.addEventListener("blur", stop);
    return () => {
      window.removeEventListener("blur", stop);
      release();
    };
  }, [stop, release]);
  if (disabled) return null;
  return (
    <div
      ref={rail}
      className={`sidebar-resize${dragging ? " dragging" : ""}`}
      style={{ left: width - 8 }}
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize sidebar"
      aria-controls={controls}
      aria-valuemin={SIDEBAR_MIN}
      aria-valuemax={SIDEBAR_MAX}
      aria-valuenow={width}
      aria-valuetext={`${width} pixels`}
      tabIndex={0}
      onPointerDown={(event) => {
        if (event.button !== 0 || event.isPrimary === false || active.current)
          return;
        event.preventDefault();
        event.currentTarget.focus();
        active.current = {
          id: event.pointerId,
          x: event.clientX,
          width,
          element: event.currentTarget,
        };
        event.currentTarget.setPointerCapture(event.pointerId);
        setDragging(true);
      }}
      onPointerMove={(event) => {
        const pointer = active.current;
        if (
          !pointer ||
          event.pointerId !== pointer.id ||
          current.current.disabled
        )
          return;
        current.current.onChange(
          clamp(pointer.width + event.clientX - pointer.x),
        );
      }}
      onPointerUp={(event) => {
        if (event.pointerId === active.current?.id) stop();
      }}
      onPointerCancel={(event) => {
        if (event.pointerId === active.current?.id) stop();
      }}
      onLostPointerCapture={(event) => {
        if (event.pointerId === active.current?.id) stop();
      }}
      onBlur={stop}
      onDoubleClick={() => {
        stop();
        onChange(SIDEBAR_DEFAULT);
      }}
      onKeyDown={(event) => {
        if (
          event.key !== "ArrowLeft" &&
          event.key !== "ArrowRight" &&
          event.key !== "Enter"
        )
          return;
        event.preventDefault();
        stop();
        onChange(
          event.key === "Enter"
            ? SIDEBAR_DEFAULT
            : clamp(width + (event.key === "ArrowLeft" ? -16 : 16)),
        );
      }}
    >
      {dragging && (
        <span className="sidebar-width-pill" aria-hidden="true">
          {width}
          {width === SIDEBAR_MIN
            ? " · minimum"
            : width === SIDEBAR_MAX
              ? " · maximum"
              : ""}
        </span>
      )}
    </div>
  );
}
