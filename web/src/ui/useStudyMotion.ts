import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { AnimationEvent } from "react";

/** Presentation identity only: never retain an entry, card, text or snapshot. */
export type StudyMotionLocator = Readonly<{
  epoch: string;
  sessionId: string;
  cardId: string;
  entryId: string;
  cardRevision: number;
  entryRevision: number;
  side: "question" | "answer";
}>;
type Phase =
  "stable" | "reveal-exit" | "answer-enter" | "confirmed-exit" | "next-enter";
type Presence = {
  phase: Phase;
  nonce: number;
  locator: StudyMotionLocator | null;
  eventId: string | null;
};
const duration: Record<Phase, number> = {
  stable: 0,
  "reveal-exit": 105,
  "answer-enter": 150,
  "confirmed-exit": 140,
  "next-enter": 200,
};
const animation: Record<Phase, string> = {
  stable: "",
  "reveal-exit": "study-reveal-out",
  "answer-enter": "study-answer-in",
  "confirmed-exit": "study-card-out",
  "next-enter": "study-next-in",
};

export function useStudyMotion(
  covered: boolean,
  isCurrent?: (locator: StudyMotionLocator) => boolean,
) {
  const [presence, setPresence] = useState<Presence>({
    phase: "stable",
    nonce: 0,
    locator: null,
    eventId: null,
  });
  const live = useRef(presence),
    alive = useRef(true),
    timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const validate = useRef(isCurrent);
  validate.current = isCurrent;
  function publish(next: Presence) {
    live.current = next;
    setPresence(next);
  }
  function clearTimer() {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  }
  function invalidate() {
    clearTimer();
    const next: Presence = {
      phase: "stable",
      nonce: live.current.nonce + 1,
      locator: null,
      eventId: null,
    };
    live.current = next;
    if (alive.current) setPresence(next);
  }
  function finish(nonce: number) {
    const current = live.current;
    if (!alive.current || nonce !== current.nonce || current.phase === "stable")
      return;
    if (
      current.locator &&
      validate.current &&
      !validate.current(current.locator)
    ) {
      invalidate();
      return;
    }
    clearTimer();
    publish({
      ...current,
      nonce: current.nonce + (current.locator ? 1 : 0),
      locator: null,
      phase:
        current.phase === "reveal-exit"
          ? "answer-enter"
          : current.phase === "confirmed-exit"
            ? "next-enter"
            : "stable",
    });
  }
  function begin(
    phase: "reveal-exit" | "confirmed-exit",
    locator: StudyMotionLocator,
    eventId: string | null = null,
  ) {
    if (covered || document.hidden) {
      invalidate();
      return;
    }
    if (
      phase === "confirmed-exit" &&
      eventId &&
      live.current.eventId === eventId
    )
      return;
    clearTimer();
    publish({
      phase,
      locator: Object.freeze({ ...locator }),
      eventId,
      nonce: live.current.nonce + 1,
    });
  }
  useLayoutEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      clearTimer();
      live.current = {
        phase: "stable",
        nonce: live.current.nonce + 1,
        locator: null,
        eventId: null,
      };
    };
  }, []);
  useLayoutEffect(() => {
    if (covered) invalidate();
  }, [covered]);
  useEffect(() => {
    const changed = () => {
      if (document.hidden) invalidate();
    };
    document.addEventListener("visibilitychange", changed);
    const observer = new MutationObserver(() => invalidate());
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-motion"],
    });
    const media =
      typeof matchMedia === "function"
        ? matchMedia("(prefers-reduced-motion: reduce)")
        : null;
    media?.addEventListener("change", invalidate);
    return () => {
      document.removeEventListener("visibilitychange", changed);
      observer.disconnect();
      media?.removeEventListener("change", invalidate);
    };
  }, []);
  useEffect(() => {
    if (presence.phase === "stable") return;
    // Missing animation events settle presentation only; 34ms is a two-frame safety margin.
    timer.current = setTimeout(
      () => finish(presence.nonce),
      duration[presence.phase] + 34,
    );
    return clearTimer;
  }, [presence.nonce, presence.phase]);
  function onAnimationEnd(event: AnimationEvent<HTMLElement>) {
    if (
      event.target !== event.currentTarget ||
      event.animationName !== animation[presence.phase]
    )
      return;
    finish(presence.nonce);
  }
  function enter() {
    clearTimer();
    publish({
      phase: "answer-enter",
      nonce: live.current.nonce + 1,
      locator: null,
      eventId: null,
    });
  }
  return {
    ...presence,
    exiting:
      presence.phase === "reveal-exit" || presence.phase === "confirmed-exit",
    begin,
    enter,
    invalidate,
    onAnimationEnd,
  };
}

/** No dwell clock here: expiry is admitted exclusively by useStudyToastLifetime. */
export function useStudyToastExit(
  eventId: string | null,
  remove: (id: string) => void,
) {
  const [exiting, setExiting] = useState<string | null>(null),
    current = useRef(eventId),
    timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  current.current = eventId;
  const removeRef = useRef(remove);
  removeRef.current = remove;
  function finish(id: string) {
    if (current.current === id) removeRef.current(id);
  }
  useLayoutEffect(() => {
    setExiting(null);
    return () => {
      if (timer.current !== null) clearTimeout(timer.current);
    };
  }, [eventId]);
  useEffect(() => {
    if (!exiting || exiting !== eventId) return;
    timer.current = setTimeout(() => finish(exiting), 174);
    return () => {
      if (timer.current !== null) clearTimeout(timer.current);
    };
  }, [exiting, eventId]);
  return {
    exiting: exiting !== null && exiting === eventId,
    expire(id: string) {
      if (current.current === id) setExiting(id);
    },
    onAnimationEnd(event: AnimationEvent<HTMLElement>) {
      if (
        event.target === event.currentTarget &&
        event.animationName === "study-toast-out" &&
        exiting === current.current &&
        exiting
      )
        finish(exiting);
    },
  };
}

export function useStudyColdLoading(
  hasSnapshot: boolean,
  failed: boolean,
  scopeKey = 0,
) {
  const [loader, setLoader] = useState(false),
    [entering, setEntering] = useState(false),
    ticket = useRef(0),
    wasShown = useRef(false),
    priorScope = useRef(scopeKey);
  useLayoutEffect(() => {
    const scope = ++ticket.current;
    if (priorScope.current !== scopeKey) {
      priorScope.current = scopeKey;
      wasShown.current = false;
    }
    if (failed) {
      setLoader(false);
      setEntering(false);
      wasShown.current = false;
      return;
    }
    if (hasSnapshot) {
      setLoader(false);
      if (!wasShown.current) return;
      wasShown.current = false;
      setEntering(true);
      const timer = setTimeout(() => {
        if (ticket.current === scope) setEntering(false);
      }, 184);
      return () => clearTimeout(timer);
    }
    setEntering(false);
    setLoader(false);
    const timer = setTimeout(() => {
      if (ticket.current === scope) {
        wasShown.current = true;
        setLoader(true);
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [hasSnapshot, failed, scopeKey]);
  return { loader, entering };
}
