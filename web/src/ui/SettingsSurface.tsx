import { useEffect, useRef, type ReactNode } from "react";
import { useDesktop } from "../desktop/DesktopShell";
import { Dialog } from "./primitives";
import "../styles/settings-desktop.css";

export function SettingsSurface({ children, onClose, returnFocusTo }: {
  children: ReactNode;
  onClose: () => void;
  returnFocusTo?: HTMLElement | null;
}) {
  const desktop = useDesktop();
  const ref = useRef<HTMLElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (!desktop) return;
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>("button, input")?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented &&
          !document.querySelector('[role="menu"], dialog[open]')) {
        event.preventDefault();
        close.current();
      }
    };
    document.addEventListener("keydown", keydown);
    return () => {
      document.removeEventListener("keydown", keydown);
      const target = returnFocusTo?.isConnected ? returnFocusTo : previous;
      if (target?.isConnected) target.focus();
    };
  }, [!!desktop]);
  if (!desktop) return <Dialog title="Settings" className="settings-dialog" onClose={onClose} returnFocusTo={returnFocusTo}>{children}</Dialog>;
  return <section ref={ref} className="settings-desktop-surface" role="region" aria-label="Settings screen">{children}</section>;
}
