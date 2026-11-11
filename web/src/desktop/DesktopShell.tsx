import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject, type CSSProperties } from "react";
import { PanelLeft, Minus, Square, Copy, X } from "lucide-react";
import { checkClose, lockClosing } from "./closeGuard";
import { freezeWindow } from "./freeze";
import { connectWindow, isDesktop, type DesktopWindow } from "./window";
import "./desktop.css";

export type DesktopLayout = { sidebarWidth: number; sidebarVisible: boolean };

type Navigation = { expanded: boolean; toggle: () => void };
type DesktopContextValue = {
  toolbar: HTMLElement | null;
  navigationRef: RefObject<HTMLButtonElement | null>;
  setNavigation: (navigation: Navigation | null) => void;
  setLayout: (layout: DesktopLayout | null) => void;
};
const DesktopContext = createContext<DesktopContextValue | null>(null);
export const useDesktop = () => useContext(DesktopContext);

export function DesktopShell({ children }: { children: ReactNode }) {
  if (!isDesktop()) return children;
  return <NativeShell>{children}</NativeShell>;
}

// Preserve an existing focused action when its scrollport shrinks. Fixed menu
// items are outside the strip and must not change the trigger strip's position.
function revealToolbarFocus(toolbar: HTMLElement | null) {
  const focused = document.activeElement;
  if (!toolbar || !(focused instanceof HTMLElement) ||
      !toolbar.contains(focused) || focused.closest('[role="menu"]')) return;
  const viewport = toolbar.getBoundingClientRect();
  const control = focused.getBoundingClientRect();
  const left = viewport.left + toolbar.clientLeft;
  const right = left + toolbar.clientWidth;
  const delta = control.left < left ? control.left - left
    : control.right > right ? control.right - right : 0;
  if (delta) toolbar.scrollLeft = Math.max(0, Math.min(
    toolbar.scrollWidth - toolbar.clientWidth, toolbar.scrollLeft + delta,
  ));
}

function NativeShell({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [started, setStarted] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [maximized, setMaximized] = useState(false);
  const [layout, setLayout] = useState<DesktopLayout | null>(null);
  const [navigation, setNavigation] = useState<Navigation | null>(null);
  const [toolbar, setToolbar] = useState<HTMLDivElement | null>(null);
  const navigationRef = useRef<HTMLButtonElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const releaseClose = useRef<(() => void) | null>(null);
  const bridge = useRef<DesktopWindow | null>(null);
  const closing = useRef(false);
  const failure = () => setError("Window controls aren’t available. Try again.");
  useLayoutEffect(() => {
    if (!toolbar || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => revealToolbarFocus(toolbar));
    observer.observe(toolbar);
    return () => observer.disconnect();
  }, [toolbar]);
  useLayoutEffect(() => {
    document.documentElement.dataset.desktop = "true";
    return () => { delete document.documentElement.dataset.desktop; };
  }, []);
  useLayoutEffect(() => {
    if (started && !ready && content.current) return freezeWindow(content.current);
  }, [started, ready]);
  useEffect(() => {
    let active = true;
    let connection: DesktopWindow | undefined;
    setReady(false);
    const resize = () => {
      void bridge.current?.isMaximized().then(value => { if (active) setMaximized(value); }).catch(failure);
    };
    void connectWindow((requestId) => {
      const current = bridge.current;
      if (!active || !current || closing.current) return;
      const result = checkClose();
      if (result !== "allowed") {
        setNotice(result === "working" ? "Notes is still working. Wait for it to finish before closing." : "");
        return;
      }
      closing.current = true;
      const unlock = lockClosing();
      const unfreeze = root.current ? freezeWindow(root.current) : () => {};
      releaseClose.current = () => { unfreeze(); unlock(); };
      void current.finishClose(requestId).catch(() => {
        closing.current = false;
        releaseClose.current?.();
        releaseClose.current = null;
        if (active) failure();
      });
    }, resize).then(value => {
      if (!active) { value.dispose(); return; }
      connection = value;
      bridge.current = value;
      setError("");
      setReady(true);
      setStarted(true);
      resize();
    }).catch(() => { if (active) failure(); });
    return () => {
      active = false;
      if (bridge.current === connection) bridge.current = null;
      connection?.dispose();
      releaseClose.current?.();
      releaseClose.current = null;
    };
  }, [attempt]);
  function run(action: (window: DesktopWindow) => Promise<void>) {
    if (bridge.current) void action(bridge.current).catch(failure);
  }
  return <DesktopContext.Provider value={{ toolbar, navigationRef, setNavigation, setLayout }}>
    <div className="desktop-shell" ref={root} data-layout={layout ? "workspace" : "single-pane"}
      data-sidebar-visible={!!layout?.sidebarVisible}
      style={{ "--desktop-sidebar-width": `${layout?.sidebarWidth ?? 224}px` } as CSSProperties}>
      <header className="desktop-titlebar" aria-label="Window toolbar" onMouseDown={event => {
        if (event.button !== 0 || !ready || (event.target as HTMLElement).closest("button, a, input, textarea, select, [role='menu'], [data-window-interactive]")) return;
        if (event.detail === 2) run(window => window.toggleMaximize());
        else run(window => window.startDragging());
      }} onContextMenu={event => {
        if ((event.target as HTMLElement).closest("button, a, input, textarea, select, [role='menu'], [data-window-interactive]")) return;
        event.preventDefault(); run(window => window.showSystemMenu());
      }}>
        {navigation && <button ref={navigationRef} className="desktop-sidebar-toggle" disabled={!ready}
          aria-label={navigation.expanded ? "Hide sidebar" : "Show sidebar"} aria-expanded={navigation.expanded}
          aria-controls="notes-sidebar" onClick={navigation.toggle}><PanelLeft size={16} strokeWidth={1.6} /></button>}
        <div className="desktop-drag-area" />
        <div className="desktop-editor-toolbar" data-window-interactive="true" ref={setToolbar}
          onFocusCapture={() => revealToolbarFocus(toolbar)} />
        <div className="desktop-caption-controls">
          <button data-preserves-editor-draft="true" aria-label="Minimize window" title="Minimize" disabled={!ready} onClick={() => run(window => window.minimize())}><Minus size={12} /></button>
          <button data-preserves-editor-draft="true" aria-label={maximized ? "Restore window" : "Maximize window"} title={maximized ? "Restore" : "Maximize"} disabled={!ready} onClick={() => run(window => window.toggleMaximize())}>{maximized ? <Copy size={11} /> : <Square size={10} />}</button>
          <button className="desktop-close" aria-label="Close window" title="Close" disabled={!ready} onClick={() => run(window => window.close())}><X size={13} /></button>
        </div>
      </header>
      {(error || notice) && <div className="desktop-window-notice" role="status">{error || notice}
        {error ? <button onClick={() => { setError(""); setAttempt(value => value + 1); }}>Retry</button>
          : <button aria-label="Dismiss window notice" onClick={() => setNotice("")}>×</button>}
      </div>}
      {started ? <div className="desktop-content" ref={content}>{children}</div>
        : <main className="loading" aria-label="Opening Notes" aria-busy={!error} />}
    </div>
  </DesktopContext.Provider>;
}
