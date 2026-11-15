import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject, type CSSProperties } from "react";
import { PanelLeft, Minus, Square, RestoreWindow, X, ChevronLeft, ChevronRight, ChevronDown } from "../ui/icons";
import { checkClose, lockClosing } from "./closeGuard";
import { freezeWindow } from "./freeze";
import { connectWindow, isDesktop, type DesktopWindow } from "./window";
import "./desktop.css";
import { NotesMark } from "../ui/NotesMark";
import { installQuitGuard, openQuickNote } from "./capture";
import { invoke } from "@tauri-apps/api/core";

export type DesktopLayout = { sidebarWidth: number; sidebarVisible: boolean };

export type DesktopChrome = { title: string; settingsOpen?: boolean; canBack: boolean; canForward: boolean; back: () => void; forward: () => void; openSettings: () => void; newNote: () => void };

type Navigation = { expanded: boolean; pinned?: boolean; toggle: () => void };
type DesktopContextValue = {
  toolbar: HTMLElement | null;
  sidebarExpanded: boolean;
  sidebarPinned: boolean;
  setChrome: (chrome: DesktopChrome | null) => void;
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
  const [chrome, setChrome] = useState<DesktopChrome | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const [navigation, setNavigation] = useState<Navigation | null>(null);
  const [toolbar, setToolbar] = useState<HTMLDivElement | null>(null);
  const navigationRef = useRef<HTMLButtonElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const releaseClose = useRef<(() => void) | null>(null);
  const bridge = useRef<DesktopWindow | null>(null);
  const closing = useRef(false);
  useEffect(() => {
    let active = true, stop: (() => void) | undefined;
    if (root.current) void installQuitGuard(root.current, () => { if (active) setNotice("Notes stayed open. Save or copy unfinished work before quitting."); }).then(value => { if (active) stop = value; else value(); }).catch(() => { if (active) setNotice("Quit coordination is unavailable. Reopen Notes before trying again."); });
    return () => { active = false; stop?.(); };
  }, []);
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
      window.dispatchEvent(new Event("blur"));
      void current.finishClose(requestId).then(() => { closing.current = false; releaseClose.current?.(); releaseClose.current = null; }).catch(() => {
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
      void invoke<string | null>("capture_shortcut_status").then(warning => { if (active && warning) setNotice(warning); }).catch(() => {});
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
  useEffect(() => {
    if (!menuOpen) return;
    const outside = (event: PointerEvent) => { if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false); };
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") { setMenuOpen(false); menuButton.current?.focus(); } };
    menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", key); };
  }, [menuOpen]);
  function run(action: (window: DesktopWindow) => Promise<void>) {
    if (bridge.current) void action(bridge.current).catch(failure);
  }
  return <DesktopContext.Provider value={{ toolbar, navigationRef, setNavigation, setLayout, setChrome, sidebarExpanded: navigation?.expanded ?? false, sidebarPinned: navigation?.pinned ?? navigation?.expanded ?? false }}>
    <div className="desktop-shell" ref={root} data-layout={layout ? "workspace" : "single-pane"}
      data-sidebar-visible={!!layout?.sidebarVisible} data-current-view={chrome?.title} data-settings-open={!!chrome?.settingsOpen}
      style={{ "--desktop-sidebar-width": `${layout?.sidebarWidth ?? 224}px` } as CSSProperties}>
      <header className="desktop-titlebar" aria-label="Window toolbar" onMouseDown={event => {
        if (event.button !== 0 || !ready || (event.target as HTMLElement).closest("button, a, input, textarea, select, [role='menu'], [data-window-interactive]")) return;
        if (event.detail === 2) run(window => window.toggleMaximize());
        else run(window => window.startDragging());
      }} onContextMenu={event => {
        if ((event.target as HTMLElement).closest("button, a, input, textarea, select, [role='menu'], [data-window-interactive]")) return;
        event.preventDefault(); run(window => window.showSystemMenu());
      }}>
        <div className="desktop-navigation">
          <button ref={navigationRef} className="desktop-chrome desktop-sidebar-toggle" disabled={!ready || !navigation}
            aria-label={(navigation?.pinned ?? navigation?.expanded) ? "Hide sidebar" : "Show sidebar"} aria-expanded={navigation?.expanded ?? false}
            aria-controls="notes-sidebar" onClick={navigation?.toggle}><PanelLeft size={16} strokeWidth={1.4} /></button>
          <span className="desktop-divider" aria-hidden="true" />
          <button className="desktop-chrome" aria-label="Back" disabled={!ready || !chrome?.canBack} onClick={chrome?.back}><ChevronLeft size={16} strokeWidth={1.4} /></button>
          <button className="desktop-chrome" aria-label="Forward" disabled={!ready || !chrome?.canForward} onClick={chrome?.forward}><ChevronRight size={16} strokeWidth={1.4} /></button>
          <div className="desktop-breadcrumb" aria-label="Location"><span>Workspace</span>{chrome && <><span className="desktop-slash" aria-hidden="true">/</span><strong>{chrome.title}</strong></>}</div>
        </div>
        <div className="desktop-app-name" aria-label="Orbyn Notes">
          <NotesMark size={16} /><span>Orbyn Notes</span>
        </div>
        <div className="desktop-menu-anchor" ref={menuRef}>
          <button ref={menuButton} className="desktop-chrome desktop-menu" aria-label="App menu" aria-haspopup="menu" aria-expanded={menuOpen} disabled={!ready || !chrome} onClick={() => setMenuOpen(value => !value)}>Menu <ChevronDown size={11} /></button>
          {menuOpen && <div className="action-menu desktop-app-menu" role="menu" aria-label="App menu" onKeyDown={event => {
            if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
            event.preventDefault();
            const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));
            const index = items.indexOf(document.activeElement as HTMLButtonElement);
            items[event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : event.key === "ArrowDown" ? (index + 1) % items.length : (index - 1 + items.length) % items.length]?.focus();
          }}>
            <button role="menuitem" onClick={() => { setMenuOpen(false); chrome?.newNote(); }}>New note</button>
            <button role="menuitem" onClick={() => { setMenuOpen(false); void openQuickNote().catch(() => setNotice("Quick note could not open. Try again.")); }}>Quick note <kbd>Ctrl Shift N</kbd></button>
            <button role="menuitem" onClick={() => { setMenuOpen(false); chrome?.openSettings(); }}>Settings</button>
            <button role="menuitem" onClick={() => { setMenuOpen(false); void invoke("capture_quit").catch(() => setNotice("Notes could not quit. Try again.")); }}>Quit Notes</button>
          </div>}
        </div>
        <div className="desktop-caption-controls">
          <button data-preserves-editor-draft="true" aria-label="Minimize window" title="Minimize" disabled={!ready} onClick={() => run(window => window.minimize())}><Minus size={12} /></button>
          <button data-preserves-editor-draft="true" aria-label={maximized ? "Restore window" : "Maximize window"} title={maximized ? "Restore" : "Maximize"} disabled={!ready} onClick={() => run(window => window.toggleMaximize())}>{maximized ? <RestoreWindow size={11} /> : <Square size={10} />}</button>
          <button className="desktop-close" aria-label="Close window" title="Close" disabled={!ready} onClick={() => run(window => window.close())}><X size={13} /></button>
        </div>
      </header>
      <div className="desktop-editor-toolbar" data-window-interactive="true" hidden={chrome?.settingsOpen === true} ref={setToolbar}
        onFocusCapture={() => revealToolbarFocus(toolbar)} />
      {(error || notice) && <div className="desktop-window-notice" role="status">{error || notice}
        {error ? <button onClick={() => { setError(""); setAttempt(value => value + 1); }}>Retry</button>
          : <button aria-label="Dismiss window notice" onClick={() => setNotice("")}>×</button>}
      </div>}
      {started ? <div className="desktop-content" ref={content}>{children}</div>
        : <main className="loading" aria-label="Opening Notes" aria-busy={!error} />}
    </div>
  </DesktopContext.Provider>;
}
