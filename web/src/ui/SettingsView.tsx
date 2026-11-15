import { useCallback, useLayoutEffect, useRef, useState } from "react";
import {
  SettingsIndicator,
  SettingsMotionPane,
  useSettingsGeneration,
  useSettingsMotion,
  useSettingsPresence,
  type Pane,
  type SettingsSection,
} from "./settingsMotion";
import "../styles/settings-motion.css";
import {
  Download,
  Layers,
  Settings,
  Type,
  RefreshCw,
  Sun,
  Plug,
  ChevronLeft,
  Search,
} from "./icons";
import { StudySettingsPanel } from "./StudySettingsPanel";
import type {
  StudySettingsOwner,
  SettingsLeaveGuard,
} from "./studySettingsTypes";
import type { Theme, usePreferences } from "./primitives";
import { useEditorPreferences } from "./editorPreferences";
import { isDesktop } from "../desktop/window";
import { storageCopy } from "./storageCopy";
import { useDesktop } from "../desktop/DesktopShell";
import { isLocalSession } from "../data/local";

type SettingsProps = {
  sampleWorkspace?: boolean;
  desktopSurface?: boolean;
  sidebarExpanded?: boolean;
  studyOwner?: StudySettingsOwner;
  onStudyGuardReady?: (guard: SettingsLeaveGuard | null) => void;
  onSetup?: () => void;
  setupUnavailable?: boolean;
  email: string;
  preferences: ReturnType<typeof usePreferences>;
  onSignOut: () => void;
  onUseLocal?: () => void;
  onExport: () => void;
  onErase: () => void;
  onOpenJournal?: () => void;
  onDone: () => void;
};
const unavailable: StudySettingsOwner = { status: "unavailable" };
export function SettingsView(props: SettingsProps) {
  const {
    email,
    preferences,
    onDone,
    onStudyGuardReady,
    studyOwner = unavailable,
  } = props;
  const desktopContext = useDesktop();
  const desktop = props.desktopSurface ?? !!desktopContext;
  const sidebarPinned = props.sidebarExpanded ?? desktopContext?.sidebarPinned ?? desktopContext?.sidebarExpanded ?? true;
  const [find, setFind] = useState("");
  const [pointerInside, setPointerInside] = useState(false);
  const [focusInside, setFocusInside] = useState(false);
  const [peekSuppressed, setPeekSuppressed] = useState(false);
  const peek = !peekSuppressed && (pointerInside || focusInside);
  const generation = useSettingsGeneration(studyOwner, email);
  const policy = useSettingsMotion(preferences.motion);
  const presence = useSettingsPresence(generation, policy);
  const section = presence.current.section;
  const guard = useRef<{
    paneInstanceId: number;
    ownerGeneration: number;
    guard: SettingsLeaveGuard;
  } | null>(null);
  const current = useRef(presence.current);
  current.current = presence.current;
  const callback = useRef(onStudyGuardReady);
  callback.current = onStudyGuardReady;
  const alive = useRef(true);
  useLayoutEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      guard.current = null;
      callback.current?.(null);
    };
  }, []);
  useLayoutEffect(() => {
    if (
      guard.current &&
      (guard.current.paneInstanceId !== current.current.instanceId ||
        guard.current.ownerGeneration !== generation)
    ) {
      guard.current = null;
      callback.current?.(null);
    }
  }, [generation, presence.current.instanceId]);
  const register = useCallback(
    (pane: Pane, value: SettingsLeaveGuard | null) => {
      if (value) {
        if (
          !alive.current ||
          current.current.instanceId !== pane.instanceId ||
          current.current.ownerGeneration !== pane.ownerGeneration
        )
          return;
        guard.current = {
          paneInstanceId: pane.instanceId,
          ownerGeneration: pane.ownerGeneration,
          guard: value,
        };
        callback.current?.(value);
      } else if (
        guard.current?.paneInstanceId === pane.instanceId &&
        guard.current.ownerGeneration === pane.ownerGeneration
      ) {
        guard.current = null;
        callback.current?.(null);
      }
    },
    [],
  );
  function leave(action: () => void) {
    const owner = generation;
    const instance = current.current.instanceId;
    const proceed = () => {
      if (
        alive.current &&
        current.current.ownerGeneration === owner &&
        current.current.instanceId === instance
      )
        action();
    };
    const lease = guard.current;
    if (
      lease?.paneInstanceId === current.current.instanceId &&
      lease.ownerGeneration === owner
    )
      lease.guard.requestLeave(proceed);
    else proceed();
  }
  const nav = useRef<HTMLElement>(null);
  function navigate(id: SettingsSection) {
    leave(() => {
      if (id === section) return;
      nav.current
        ?.querySelector<HTMLButtonElement>(`[data-settings-section="${id}"]`)
        ?.focus();
      guard.current = null;
      callback.current?.(null);
      presence.navigate(id);
    });
  }
  return (
    <div className="settings-layout" data-settings-motion={policy} data-settings-expanded={desktop ? (props.sidebarExpanded ?? (sidebarPinned || peek)) : undefined} data-settings-pinned={desktop ? sidebarPinned : undefined}>
      <nav ref={nav} className="settings-nav" aria-label="Settings sections"
        onPointerEnter={(event) => { if (event.pointerType !== "touch") setPointerInside(true); }}
        onPointerLeave={(event) => { if (event.pointerType !== "touch") { setPointerInside(false); if (!focusInside) setPeekSuppressed(false); } }}
        onFocus={() => setFocusInside(true)}
        onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) { setFocusInside(false); if (!pointerInside) setPeekSuppressed(false); } }}
        onKeyDown={(event) => { if (event.key === "Escape" && desktop && !sidebarPinned && peek) { event.preventDefault(); event.stopPropagation(); setPeekSuppressed(true); } }}>
        {desktop && <button className="settings-back" aria-label="Back to workspace" title="Back to workspace" onClick={() => leave(onDone)}><ChevronLeft size={15} aria-hidden="true" /><span>Settings</span></button>}
        {desktop && <label className="settings-search"><Search size={13} aria-hidden="true" /><input aria-label="Find a setting" placeholder="Find a setting" value={find} onChange={(event) => setFind(event.target.value)} /></label>}
        <SettingsIndicator
          key={generation}
          className="settings-nav-indicators"
          selector='[aria-current="page"]'
          policy={policy}
        >
          {(
            [
              ["general", "General", Settings, false],
              ["editor", "Editor", Type, false],
              ["sync", "Sync", RefreshCw, true],
              ["study", "Study", Layers, false],
              ["journal", "Journal", Sun, false],
              ["apps", "Connected apps", Plug, true],
              ["data", "Data and export", Download, false],
            ] as const
          ).filter(([, label]) => label.toLowerCase().includes(find.trim().toLowerCase())).map(([id, label, Icon, planned]) => (
            <button
              key={id}
              data-settings-section={id}
              title={label}
              aria-label={planned ? `${label} Planned` : label}
              aria-current={section === id ? "page" : undefined}
              onClick={() => navigate(id)}
            >
              <Icon size={15} aria-hidden="true" />
              <span>{label}</span>
              {planned && (
                <>
                  {" "}
                  <small className="settings-planned">Planned</small>
                </>
              )}
            </button>
          ))}
        </SettingsIndicator>
        {find.trim() && !["General", "Editor", "Sync", "Study", "Journal", "Connected apps", "Data and export"].some((label) => label.toLowerCase().includes(find.trim().toLowerCase())) && <p className="settings-search-empty" role="status">No settings found</p>}
      </nav>
      <div className="settings-pane settings-pane-stack">
        {!desktop && <button className="settings-motion-done" onClick={() => leave(onDone)}>
          Done
        </button>}
        {[presence.outgoing, presence.current]
          .filter((pane): pane is Pane => !!pane)
          .map((pane) => (
            <SettingsMotionPane
              key={pane.instanceId}
              pane={pane}
              policy={policy}
              elements={presence.elements}
              complete={presence.complete}
            >
              <SettingsPaneContent
                {...props}
                desktopSurface={desktop}
                studyOwner={studyOwner}
                section={pane.section}
                pane={pane}
                register={register}
                leave={leave}
                policy={policy}
              />
            </SettingsMotionPane>
          ))}
      </div>
    </div>
  );
}

function SettingsPaneContent({
  sampleWorkspace = false,
  desktopSurface,
  email,
  preferences,
  onSignOut,
  onUseLocal,
  onExport,
  onErase,
  onOpenJournal,
  onSetup,
  setupUnavailable = false,
  studyOwner = unavailable,
  section,
  pane,
  register,
  leave,
  policy,
}: SettingsProps & {
  section: SettingsSection;
  pane: Pane;
  register: (pane: Pane, guard: SettingsLeaveGuard | null) => void;
  leave: (action: () => void) => void;
  policy: "full" | "reduced";
}) {
  const desktopContext = useDesktop();
  const desktop = desktopSurface ?? !!desktopContext;
  const local = isLocalSession({ email });
  const editor = useEditorPreferences();
  const registerGuard = useCallback(
    (value: SettingsLeaveGuard | null) => register(pane, value),
    [register, pane.instanceId, pane.ownerGeneration],
  );
  return (
    <>
      <header className="settings-heading">
        <h3>
          {
            {
              general: "General",
              editor: "Editor",
              sync: "Sync",
              study: "Study",
              journal: "Journal",
              apps: "Connected apps",
              data: "Data and export",
            }[section]
          }
        </h3>
      </header>
      <div className="settings-content">
        {section === "general" ? (
          <>
            {desktop && <h4 className="settings-group-heading">Workspace</h4>}
            <div className="settings-group">
            <div className="settings-row">
              <div>
                <b>{sampleWorkspace ? "Sample workspace" : local ? "Local workspace" : "Account"}</b>
                <small>{sampleWorkspace ? "Changes last until you leave or reload. No account or sync." : local ? "Saved on this device. No account or sync." : email}</small>
              </div>
              {!sampleWorkspace && <button onClick={onSignOut}>{local ? "Close workspace" : "Sign out"}</button>}
            </div>
            {!local && onUseLocal && <div className="settings-row">
              <div><b>Local workspace</b><small>Keep a separate library on this device without an account.</small></div>
              <button onClick={() => leave(onUseLocal)}>Use without an account</button>
            </div>}
            <div className="settings-row">
              <b>Plan</b>
              <span>Planned</span>
            </div>
            {onSetup && (
              <div className="settings-row">
                <div>
                  <b>Set up Notes</b>
                  <small>
                    {setupUnavailable
                      ? "Finish the current note-link request first."
                      : "Optional import and local storage setup."}
                  </small>
                </div>
                <button disabled={setupUnavailable} onClick={onSetup}>
                  Set up Notes
                </button>
              </div>
            )}
            </div>
            {desktop && <h4 className="settings-group-heading">Appearance</h4>}
            <div className="settings-group">
            <div className="settings-row">
              <div>
                <b>Appearance</b>
              </div>
              <SettingsIndicator
                className="settings-segments"
                selector='[aria-pressed="true"]'
                policy={policy}
                label="Appearance"
              >
                {(["system", "light", "dark", "dim"] as Theme[]).map(
                  (value) => (
                    <button
                      key={value}
                      aria-pressed={preferences.theme === value}
                      onClick={() => preferences.setTheme(value)}
                    >
                      {value[0]?.toUpperCase()}
                      {value.slice(1)}
                    </button>
                  ),
                )}
              </SettingsIndicator>
            </div>
            <div className="settings-row">
              <div>
                <b>Motion</b>
              </div>
              <SettingsIndicator
                className="settings-segments"
                selector='[aria-pressed="true"]'
                policy={policy}
                label="Motion"
              >
                {["system", "on", "reduced"].map((value) => (
                  <button
                    key={value}
                    aria-pressed={preferences.motion === value}
                    onClick={() => preferences.setMotion(value)}
                  >
                    {value[0]?.toUpperCase()}
                    {value.slice(1)}
                  </button>
                ))}
              </SettingsIndicator>
            </div>
            </div>
            {desktop && <h4 className="settings-group-heading">Preferences</h4>}
            <div className="settings-group">
            <div className="settings-row">
              <b>Language</b>
              <div>
                <span>English</span>
                <small>More languages · Planned</small>
              </div>
            </div>
            <div className="settings-row">
              <b>Open at login</b>
              <span>Planned</span>
            </div>
            <div className="settings-row">
              <b>Week starts on</b>
              <span>Planned</span>
            </div>
            </div>
          </>
        ) : section === "editor" ? (
          <>
            <div className="settings-row">
              <b>Font</b>
              <span>Geist</span>
            </div>
            <div className="settings-row">
              <b>Text size</b>
              <SettingsIndicator
                className="settings-segments"
                selector='[aria-pressed="true"]'
                policy={policy}
                label="Text size"
              >
                {(["small", "medium", "large"] as const).map((size) => (
                  <button
                    key={size}
                    aria-pressed={editor.preferences.textSize === size}
                    onClick={() => editor.setPreferences({ textSize: size })}
                  >
                    {size.charAt(0).toUpperCase() + size.slice(1)}
                  </button>
                ))}
              </SettingsIndicator>
            </div>
            <div className="settings-row">
              <b>Line width</b>
              <SettingsIndicator
                className="settings-segments"
                selector='[aria-pressed="true"]'
                policy={policy}
                label="Line width"
              >
                {(["narrow", "wide"] as const).map((width) => (
                  <button
                    key={width}
                    aria-pressed={editor.preferences.lineWidth === width}
                    onClick={() => editor.setPreferences({ lineWidth: width })}
                  >
                    {width.charAt(0).toUpperCase() + width.slice(1)}
                  </button>
                ))}
              </SettingsIndicator>
            </div>
            <label className="settings-row settings-toggle">
              <span>
                <b>Turn Markdown into formatting while typing</b>
                <small>Type ## and a space to make a heading</small>
              </span>
              <input
                type="checkbox"
                checked={editor.preferences.markdown}
                onChange={(event) =>
                  editor.setPreferences({ markdown: event.target.checked })
                }
              />
            </label>
            <label className="settings-row settings-toggle">
              <b>Check spelling</b>
              <input
                type="checkbox"
                checked={editor.preferences.spellcheck}
                onChange={(event) =>
                  editor.setPreferences({ spellcheck: event.target.checked })
                }
              />
            </label>
            <div className="settings-row">
              <div>
                <b>Show “Linked from” beside notes</b>
                <small>
                  Planned · Opening backlinks by default isn’t available yet.
                  Use Links and backlinks in a note.
                </small>
              </div>
              <input
                type="checkbox"
                aria-label="Show Linked from beside notes"
                disabled
              />
            </div>
            <div className="settings-row">
              <b>Open task and event chips in</b>
              <span>Orbyn Planner · Planned</span>
            </div>
          </>
        ) : section === "sync" || section === "apps" ? (
          <div className="settings-row">
            <div>
              <b>Planned</b>
              <small>
                {section === "sync"
                  ? sampleWorkspace ? "Sample changes last until you leave or reload. Sync is unavailable." : "Notes stay on this device in this beta."
                  : "Connections to other apps and browser extensions aren’t available in this beta."}
              </small>
            </div>
          </div>
        ) : section === "journal" && sampleWorkspace ? (
          <div className="settings-row"><div><b>Sample Journal</b><small>Sample entries last until you leave or reload. Journal lock and settings are unavailable in the sample.</small></div></div>
        ) : section === "journal" ? (
          <>
            <div className="settings-row">
              <b>Lock Journal with</b>
              <span>A separate passphrase</span>
            </div>
            <div className="settings-row">
              <b>Lock after</b>
              <span>1 minute away</span>
            </div>
            <div className="settings-row">
              <b>Evening reminder</b>
              <span>Planned</span>
            </div>
            <div className="settings-row">
              <div>
                <b>Prompts and habits</b>
                <small>Open Journal to manage prompts and habits.</small>
                <small>
                  In Journal, choose Journal settings from its menu.
                </small>
              </div>
              <button
                disabled={!onOpenJournal}
                onClick={() => onOpenJournal && leave(onOpenJournal)}
              >
                Open Journal
              </button>
            </div>
          </>
        ) : section === "study" && sampleWorkspace ? (
          <div className="settings-row"><div><b>Study settings unavailable</b><small>Sample practice does not schedule reviews or save Study settings.</small></div></div>
        ) : section === "study" ? (
          <StudySettingsPanel owner={studyOwner} onGuardReady={registerGuard} />
        ) : sampleWorkspace ? (
          <div className="settings-row"><div><b>Data and export unavailable</b><small>Sample changes last until you leave or reload and can’t be exported.</small></div></div>
        ) : (
          <>
            <div className="settings-row">
              <div>
                <b>Export all notes</b>
                <small>
                  {storageCopy(isDesktop()).exportWarning}
                </small>
              </div>
              <button onClick={onExport}>Export all notes</button>
            </div>
            <div className="settings-row">
              <div>
                <b>Export Journal</b>
                <small>
                  Open Journal, then choose Export Journal from its menu.
                </small>
              </div>
              <button
                disabled={!onOpenJournal}
                onClick={() => onOpenJournal && leave(onOpenJournal)}
              >
                Open Journal to export
              </button>
            </div>
            <div className="settings-row">
              <div>
                <b>{storageCopy(isDesktop()).eraseLabel}</b>
              </div>
              <button className="danger" onClick={onErase}>
                {storageCopy(isDesktop()).eraseLabel}
              </button>
            </div>
          </>
        )}
      </div>
    </>
  );
}
