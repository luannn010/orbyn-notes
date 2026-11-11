import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { AnimationEvent } from "react";
import type { JournalHabitDetail } from "./journalHabitDetails";

/** Owned by the unlocked Journal tree. Presence retains numeric scalars only. */
export function JournalHabitFeedback({
  name,
  detail,
  throughLabel,
  disabled,
  onToggle,
}: {
  name: string;
  detail: JournalHabitDetail;
  throughLabel: string | null;
  disabled: boolean;
  onToggle: () => void;
}) {
  const description = useId();
  const count = useRef(detail.days),
    generation = useRef(0),
    alive = useRef(true);
  const [presence, setPresence] = useState<{
    outgoing: number | null;
    entering: boolean;
    nonce: number;
  }>({ outgoing: null, entering: false, nonce: 0 });
  useLayoutEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      generation.current++;
    };
  }, []);
  useLayoutEffect(() => {
    if (count.current === detail.days) return;
    const outgoing = count.current;
    count.current = detail.days;
    setPresence({ outgoing, entering: true, nonce: ++generation.current });
  }, [detail.days]);
  useEffect(() => {
    if (!presence.nonce) return;
    const nonce = presence.nonce;
    // Normal exit is105ms; effective reduced exit/entry is150ms. This
    // presentation-only fallback also covers a policy change mid-transition.
    const timer = setTimeout(() => {
      if (alive.current && generation.current === nonce)
        setPresence((current) =>
          current.outgoing === null && !current.entering
            ? current
            : { ...current, outgoing: null, entering: false },
        );
    }, 150 + 34);
    return () => clearTimeout(timer);
  }, [presence.nonce]);
  function finish(event: AnimationEvent<HTMLSpanElement>, leaving: boolean) {
    if (
      event.target !== event.currentTarget ||
      !alive.current ||
      generation.current !== presence.nonce ||
      event.animationName !==
        (leaving ? "journal-streak-out" : "journal-streak-in")
    )
      return;
    setPresence((current) =>
      leaving
        ? { ...current, outgoing: null }
        : { ...current, entering: false },
    );
  }
  return (
    <button
      type="button"
      aria-label={name}
      aria-describedby={description}
      aria-pressed={detail.completed}
      disabled={disabled}
      onClick={onToggle}
    >
      <span className="journal-check" aria-hidden="true">
        <span className="journal-check-mark" />
      </span>
      <span>{name}</span>
      <small className="journal-habit-streak" aria-hidden="true">
        {presence.outgoing !== null && (
          <span
            key={`out-${presence.nonce}`}
            className="journal-habit-count"
            data-leaving="true"
            onAnimationEnd={(event) => finish(event, true)}
          >
            {presence.outgoing} {presence.outgoing === 1 ? "day" : "days"}
          </span>
        )}
        <span
          key={presence.nonce}
          className="journal-habit-count"
          data-entering={presence.entering || undefined}
          onAnimationEnd={(event) => finish(event, false)}
        >
          {detail.days} {detail.days === 1 ? "day" : "days"}
        </span>
      </small>
      <span id={description} className="journal-sr-only">
        {detail.days === 0
          ? "0 day streak."
          : `${detail.days} consecutive ${detail.days === 1 ? "day" : "days"}${throughLabel ? ` through ${throughLabel}` : ""}.`}
      </span>
    </button>
  );
}
