import { useCallback, useLayoutEffect, useRef } from "react";
import type { FocusEvent } from "react";

const DWELL_MS = 5000;
type Clock = {
  id: string | null;
  remaining: number;
  started: number | null;
  expired: boolean;
};

/** Presentation lifetime only: never grades, undoes, writes or changes review authority. */
export function useStudyToastLifetime(
  eventId: string | null,
  onExpire: (eventId: string) => void,
  covered = false,
) {
  const callback = useRef(onExpire),
    active = useRef(false),
    timer = useRef<ReturnType<typeof setTimeout> | null>(null),
    reasons = useRef({ hover: false, focus: false, hidden: false, covered }),
    clock = useRef<Clock>({
      id: null,
      remaining: DWELL_MS,
      started: null,
      expired: false,
    });

  const settle = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    const current = clock.current;
    if (current.started !== null) {
      current.remaining = Math.max(
        0,
        current.remaining - Math.max(0, performance.now() - current.started),
      );
      current.started = null;
    }
  }, []);

  const reconcile = useCallback(() => {
    settle();
    const current = clock.current,
      paused = reasons.current;
    if (
      !active.current ||
      !current.id ||
      current.expired ||
      paused.hover ||
      paused.focus ||
      paused.hidden ||
      paused.covered
    )
      return;
    if (current.remaining <= 0) {
      current.expired = true;
      callback.current(current.id);
      return;
    }
    current.started = performance.now();
    timer.current = setTimeout(reconcile, current.remaining);
  }, [settle]);

  useLayoutEffect(() => {
    callback.current = onExpire;
  });
  useLayoutEffect(() => {
    active.current = true;
    reasons.current.hidden = document.hidden;
    const visibility = () => {
      reasons.current.hidden = document.hidden;
      reconcile();
    };
    document.addEventListener("visibilitychange", visibility);
    reconcile();
    return () => {
      active.current = false;
      settle();
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [reconcile, settle]);

  useLayoutEffect(() => {
    if (clock.current.id !== eventId) {
      settle();
      clock.current = {
        id: eventId,
        remaining: DWELL_MS,
        started: null,
        expired: false,
      };
      // An absent toast has no hover/focus surface. A replacement still on the
      // same visible surface keeps its independent interaction pause reasons.
      if (eventId === null) {
        reasons.current.hover = false;
        reasons.current.focus = false;
      }
    }
    reasons.current.covered = covered;
    reconcile();
  }, [eventId, covered, reconcile, settle]);

  const pause = useCallback(
    (reason: "hover" | "focus", value: boolean) => {
      reasons.current[reason] = value;
      reconcile();
    },
    [reconcile],
  );
  return {
    onMouseEnter: () => pause("hover", true),
    onMouseLeave: () => pause("hover", false),
    onFocus: () => pause("focus", true),
    onBlur: (event: FocusEvent<HTMLElement>) => {
      if (
        event.relatedTarget instanceof Node &&
        event.currentTarget.contains(event.relatedTarget)
      )
        return;
      pause("focus", false);
    },
  };
}
