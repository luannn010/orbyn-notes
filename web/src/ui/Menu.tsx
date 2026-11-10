import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { flushSync } from "react-dom";

export type MenuAction = { label: string; icon?: ReactNode; disabled?: boolean; danger?: boolean; onSelect: () => void; focusAfterSelect?: boolean };
export function Menu({ label, actions }: { label: string; actions: MenuAction[] }) {
  const [phase, setPhase] = useState<"closed" | "open" | "closing">("closed");
  const [position, setPosition] = useState<CSSProperties>({ visibility: "hidden" });
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const lastOnOpen = useRef(false);
  const id = useId();
  const open = phase === "open";
  function close(restore = false) {
    setPhase("closing");
    if (restore) trigger.current?.focus();
  }
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const anchor = trigger.current?.getBoundingClientRect();
      const popup = menu.current;
      if (!anchor || !popup) return;
      const width = popup.offsetWidth, height = popup.offsetHeight;
      const below = window.innerHeight - anchor.bottom - 8;
      const above = anchor.top - 8;
      const flip = below < height && above > below;
      const available = Math.max(0, flip ? above : below);
      setPosition({ left: Math.max(8, Math.min(anchor.right - width, window.innerWidth - width - 8)), top: flip ? Math.max(8, anchor.top - Math.min(height, available) - 4) : anchor.bottom + 4, maxHeight: available, transformOrigin: flip ? "bottom right" : "top right" });
    };
    place();
    const items = menu.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)');
    const frame = requestAnimationFrame(() => (lastOnOpen.current ? items?.[items.length - 1] : items?.[0])?.focus());
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => { cancelAnimationFrame(frame); window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) close(); };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  useEffect(() => {
    if (phase !== "closing") return;
    const timer = window.setTimeout(() => setPhase("closed"), 150);
    return () => window.clearTimeout(timer);
  }, [phase]);
  function keyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") { event.preventDefault(); close(true); return; }
    if (event.key === "Tab") { close(); return; }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const items = Array.from(menu.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []);
    if (!items.length) return;
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : event.key === "ArrowDown" ? (index + 1) % items.length : (index - 1 + items.length) % items.length;
    items[next]?.focus();
  }
  return <div className="menu-anchor" ref={root}>
    <button ref={trigger} type="button" aria-label={label} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => { lastOnOpen.current = false; if (open) close(); else setPhase("open"); }} onKeyDown={event => { if (!open && (event.key === "ArrowDown" || event.key === "ArrowUp")) { event.preventDefault(); lastOnOpen.current = event.key === "ArrowUp"; setPhase("open"); } }}>•••</button>
    {phase !== "closed" && <div ref={menu} id={id} role="menu" aria-label={label} aria-hidden={!open || undefined} inert={!open} className={`action-menu ${phase === "closing" ? "action-menu-closing" : ""}`} style={position} onKeyDown={keyDown}>
      {actions.map(action => <button type="button" role="menuitem" key={action.label} disabled={action.disabled} className={action.danger ? "danger" : undefined} onClick={() => {
        flushSync(() => setPhase("closing"));
        if (!action.focusAfterSelect) trigger.current?.focus();
        action.onSelect();
      }}>{action.icon}{action.label}</button>)}
    </div>}
  </div>;
}
