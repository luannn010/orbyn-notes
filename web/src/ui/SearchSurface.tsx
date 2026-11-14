import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

/** Ordinary visual exit only; navigation is already admitted. Never retain a content snapshot. */
export function SearchSurface({
  active,
  privacyVersion,
  children,
}: {
  active: boolean;
  privacyVersion: number;
  children: ReactNode;
}) {
  const [phase, setPhase] = useState<"open" | "closing" | "closed">(
    active ? "open" : "closed",
  );
  const previousPrivacy = useRef(privacyVersion),
    ticket = useRef(0),
    currentActive = useRef(active),
    surface = useRef<HTMLDivElement>(null);
  currentActive.current = active;
  const revoked = previousPrivacy.current !== privacyVersion;
  useLayoutEffect(() => {
    const invocation = ++ticket.current;
    if (previousPrivacy.current !== privacyVersion) {
      previousPrivacy.current = privacyVersion;
      setPhase("closed");
      return;
    }
    if (active) {
      setPhase("open");
      return;
    }
    if (phase === "closed") return;
    setPhase("closing");
    const style = surface.current ? getComputedStyle(surface.current) : null;
    const ms = (value: string) =>
      value.trim().endsWith("ms")
        ? parseFloat(value)
        : parseFloat(value) * 1000;
    const durations = style?.animationDuration.split(",").map(ms) ?? [];
    const delays = style?.animationDelay.split(",").map(ms) ?? [];
    const ends = durations
      .map(
        (value, index) =>
          value + (delays[index % Math.max(1, delays.length)] || 0),
      )
      .filter(Number.isFinite);
    const timer = setTimeout(
      () => {
        if (invocation === ticket.current && !currentActive.current)
          setPhase("closed");
      },
      ends.length ? Math.max(0, ...ends) : 170,
    );
    return () => {
      ticket.current++;
      clearTimeout(timer);
    };
  }, [active, privacyVersion]);
  if (revoked || (!active && phase === "closed")) return null;
  return (
    <div
      ref={surface}
      className="workspace-search"
      data-phase={active ? "open" : "closing"}
      inert={!active}
      aria-hidden={!active}
    >
      {children}
    </div>
  );
}
