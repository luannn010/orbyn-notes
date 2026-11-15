import { useLayoutEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  BookOpen,
  Check,
  FileText,
  LogOut,
  Plus,
  Search,
  Settings,
  Sun,
} from "../ui/icons";
import { useDesktop } from "../desktop/DesktopShell";
import { NotesMark } from "../ui/NotesMark";
import { RichEditor } from "../ui/RichEditor";
import type { Theme } from "../ui/primitives";
import { SettingsSurface } from "../ui/SettingsSurface";
import { SettingsView } from "../ui/SettingsView";
import { defaultEditorPreferences, EditorPreferencesProvider } from "../ui/editorPreferences";
import { plainText } from "../ui/model";
import {
  createSample,
  dayKey,
  sampleDocument,
  type SampleNote,
} from "./fixtures";
import { SampleClips, SampleJournal, SampleStudy } from "./collections";
import "../styles/sample-workspace.css";

type Module = "notes" | "journal" | "study" | "clips";
const modules = [
  { id: "notes", label: "All notes", icon: FileText },
  { id: "journal", label: "Journal", icon: Sun },
  { id: "study", label: "Study", icon: BookOpen },
  { id: "clips", label: "Clips", icon: FileText },
] as const;

/** This host owns only disposable React state; it never establishes an account or opens a store. */
export default function SampleWorkspace({ onExit }: { onExit: () => void }) {
  const desktop = useDesktop();
  const [sidebarVisible, setSidebarVisible] = useState(true);
  const [initial] = useState(createSample);
  const [notes, setNotes] = useState(initial.notes);
  const [journal, setJournal] = useState(initial.journal);
  const [clips, setClips] = useState(initial.clips);
  const [habits, setHabits] = useState<Record<string, string[]>>({
    [dayKey(initial.today)]: ["read", "walk"],
  });
  const [module, setModule] = useState<Module>("notes");
  const [selected, setSelected] = useState<string | null>(null);
  const [tag, setTag] = useState("");
  const [query, setQuery] = useState("");
  const [settings, setSettings] = useState(false);
  const [day, setDay] = useState(initial.today);
  const [deck, setDeck] = useState<string | null>(null);
  const [card, setCard] = useState(0);
  const [answer, setAnswer] = useState(false);
  const [clip, setClip] = useState<string | null>(null);
  const [clipFilter, setClipFilter] = useState<"all" | "unread" | "read">(
    "all",
  );
  const [appearance] = useState(() => ({
    theme: document.documentElement.dataset.theme,
    motion: document.documentElement.dataset.motion,
  }));
  const [theme, setTheme] = useState<Theme>(appearance.theme === "dark" || appearance.theme === "dim" ? appearance.theme : "light");
  const [motion, setMotion] = useState(appearance.motion ?? "system");
  const [editorPreferences, setEditorPreferences] = useState(defaultEditorPreferences);
  const [originalEditorStyles] = useState(() => {
    const style = document.documentElement.style;
    return ["--notes-editor-size", "--notes-editor-width"].map((name) => ({ name, value: style.getPropertyValue(name), priority: style.getPropertyPriority(name) }));
  });
  const settingsReturnFocus = useRef<HTMLElement | null>(null);
  function openSettings() {
    settingsReturnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setSettings(true);
  }
  useLayoutEffect(
    () => () => {
      if (appearance.theme === undefined)
        delete document.documentElement.dataset.theme;
      else document.documentElement.dataset.theme = appearance.theme;
      if (appearance.motion === undefined)
        delete document.documentElement.dataset.motion;
      else document.documentElement.dataset.motion = appearance.motion;
      for (const { name, value, priority } of originalEditorStyles) {
        if (value) document.documentElement.style.setProperty(name, value, priority);
        else document.documentElement.style.removeProperty(name);
      }
    },
    [appearance, originalEditorStyles],
  );
  useLayoutEffect(() => {
    const query = matchMedia("(prefers-color-scheme: dark)");
    const applyTheme = () => { document.documentElement.dataset.theme = theme === "system" ? (query.matches ? "dark" : "light") : theme; };
    applyTheme();
    query.addEventListener("change", applyTheme);
    document.documentElement.dataset.motion = motion;
    return () => query.removeEventListener("change", applyTheme);
  }, [theme, motion]);
  useLayoutEffect(() => {
    if (!desktop) return;
    desktop.setNavigation({ expanded: sidebarVisible, toggle: () => setSidebarVisible((value) => !value) });
    desktop.setLayout({ sidebarWidth: 224, sidebarVisible });
    return () => { desktop.setNavigation(null); desktop.setLayout(null); };
  }, [desktop?.setNavigation, desktop?.setLayout, sidebarVisible]);
  const tags = [...new Set(notes.flatMap((note) => note.tags))].sort();
  const note = notes.find((item) => item.id === selected);
  const visible = notes.filter(
    (item) =>
      (!tag || item.tags.includes(tag)) &&
      `${item.title} ${plainText(item.document)} ${item.tags.join(" ")}`
        .toLocaleLowerCase()
        .includes(query.trim().toLocaleLowerCase()),
  );
  function navigate(next: Module, nextTag = "") {
    setModule(next);
    setTag(nextTag);
    setSelected(null);
  }
  function updateNote(patch: Partial<Pick<SampleNote, "title" | "document">>) {
    setNotes((current) =>
      current.map((item) =>
        item.id === selected
          ? { ...item, ...patch, updatedAt: new Date().toISOString() }
          : item,
      ),
    );
  }
  function createNote() {
    const id = crypto.randomUUID();
    setNotes((current) => [
      {
        id,
        title: "",
        document: sampleDocument(""),
        tags: tag ? [tag] : [],
        updatedAt: new Date().toISOString(),
      },
      ...current,
    ]);
    setModule("notes");
    setSelected(id);
  }
  return (
    <EditorPreferencesProvider value={{ preferences: editorPreferences, setPreferences: (patch) => setEditorPreferences((current) => ({ ...current, ...patch })) }}>
    <div className={`sample-workspace${sidebarVisible ? "" : " sample-sidebar-hidden"}`} aria-label="Sample workspace">
      <aside id="notes-sidebar" className="sample-sidebar" aria-label="Sample navigation" inert={settings} hidden={!sidebarVisible}>
        <div className="sample-brand">
          <NotesMark size={16} />
          <strong>
            Orbyn <span>Notes</span>
          </strong>
        </div>
        <div className="sample-identity">
          Sample workspace
          <button aria-label="New sample note" onClick={createNote}>
            <Plus size={15} />
          </button>
        </div>
        <label className="sample-search">
          <Search size={15} />
          <input
            aria-label="Search sample notes"
            placeholder="Search notes"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              navigate("notes");
            }}
          />
        </label>
        <nav aria-label="Collections">
          {modules.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              className={
                module === id && !tag ? "sample-nav active" : "sample-nav"
              }
              aria-label={
                id === "notes"
                  ? `${label}, ${notes.length} notes`
                  : id === "clips"
                    ? `${label}, ${clips.length} clips`
                    : label
              }
              aria-current={module === id && !tag ? "page" : undefined}
              onClick={() => navigate(id)}
            >
              <Icon size={16} />
              <span>{label}</span>
              {id === "notes" && <small>{notes.length}</small>}
              {id === "clips" && <small>{clips.length}</small>}
            </button>
          ))}
        </nav>
        <p className="sample-group">Tags</p>
        <nav aria-label="Note tags">
          {tags.map((value) => (
            <button
              key={value}
              className={
                tag === value && module === "notes"
                  ? "sample-nav active"
                  : "sample-nav"
              }
              aria-label={`${value}, ${notes.filter((item) => item.tags.includes(value)).length} notes`}
              aria-pressed={tag === value && module === "notes"}
              onClick={() => navigate("notes", value)}
            >
              <span className={`sample-tag-dot sample-tag-${value}`} />
              <span>{value}</span>
              <small>
                {notes.filter((item) => item.tags.includes(value)).length}
              </small>
            </button>
          ))}
        </nav>
        <footer>
          <p>Changes last until you leave or reload.</p>
          <button className="sample-nav" onClick={openSettings}>
            <Settings size={16} />
            Settings
          </button>
          <button className="sample-nav" onClick={onExit}>
            <LogOut size={16} />
            Exit sample
          </button>
        </footer>
      </aside>
      <main className="sample-main" inert={settings}>
        <div className="sample-status">
          <span>Sample workspace</span>
          <span>Changes last until you leave or reload.</span>
        </div>
        {module === "notes" &&
          (note ? (
            <>
              <header className="sample-page-header">
                <button onClick={() => setSelected(null)}>
                  <ArrowLeft size={15} />
                  All notes
                </button>
                <span className="sample-updated">
                  <Check size={13} />
                  Updated in sample
                </span>
              </header>
              <div className="editor-page sample-editor" key={note.id}>
                <input
                  className="sample-note-title"
                  aria-label="Note title"
                  placeholder="Untitled note"
                  value={note.title}
                  onChange={(event) =>
                    updateNote({ title: event.target.value })
                  }
                />
                <div className="sample-meta">
                  {note.tags.map((value) => (
                    <span className="sample-tag" key={value}>
                      {value}
                    </span>
                  ))}
                  <span>
                    Edited{" "}
                    {new Date(note.updatedAt).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                    })}
                  </span>
                </div>
                <RichEditor
                  documentPolicy="notes"
                  document={note.document}
                  onChange={(document) => updateNote({ document })}
                  ariaLabel="Sample note content"
                />
              </div>
            </>
          ) : (
            <>
              <header className="sample-page-header">
                <h1>{tag || "All notes"}</h1>
                <span>
                  {visible.length} {visible.length === 1 ? "note" : "notes"}
                </span>
                <button className="primary" onClick={createNote}>
                  <Plus size={15} />
                  New note
                </button>
              </header>
              <div className="sample-filters">
                <button aria-pressed={!tag} onClick={() => setTag("")}>
                  All
                </button>
                {tag && (
                  <button aria-pressed="true" onClick={() => setTag("")}>
                    {tag} ×
                  </button>
                )}
              </div>
              <div className="sample-note-list">
                {visible.map((item) => (
                  <button
                    className="sample-note-row"
                    key={item.id}
                    onClick={() => setSelected(item.id)}
                  >
                    <FileText size={15} />
                    <strong>{item.title || "Untitled note"}</strong>
                    <span className="sample-excerpt">
                      {plainText(item.document)}
                    </span>
                    <span className="sample-row-meta">
                      {item.tags.map((value) => (
                        <span className="sample-tag" key={value}>
                          {value}
                        </span>
                      ))}
                      <time dateTime={item.updatedAt}>
                        {new Date(item.updatedAt).toLocaleDateString(
                          undefined,
                          { month: "short", day: "numeric" },
                        )}
                      </time>
                    </span>
                  </button>
                ))}
              </div>
              {!visible.length && (
                <div className="sample-empty">
                  <h2>No matching notes</h2>
                  <p>Try another title, word or tag.</p>
                  <button
                    onClick={() => {
                      setQuery("");
                      setTag("");
                    }}
                  >
                    Clear filters
                  </button>
                </div>
              )}
            </>
          ))}
        {module === "journal" && (
          <SampleJournal
            day={day}
            today={initial.today}
            onDay={setDay}
            text={journal[dayKey(day)] ?? ""}
            onText={(text) =>
              setJournal((current) => ({ ...current, [dayKey(day)]: text }))
            }
            completed={habits[dayKey(day)] ?? []}
            onToggle={(id) =>
              setHabits((current) => {
                const done = current[dayKey(day)] ?? [];
                return {
                  ...current,
                  [dayKey(day)]: done.includes(id)
                    ? done.filter((value) => value !== id)
                    : [...done, id],
                };
              })
            }
          />
        )}
        {module === "study" && (
          <SampleStudy
            deckId={deck}
            onDeck={(id) => {
              setDeck(id);
              setCard(0);
              setAnswer(false);
            }}
            cardIndex={card}
            answer={answer}
            onAnswer={() => setAnswer(true)}
            onNext={() => {
              setCard((index) => index + 1);
              setAnswer(false);
            }}
          />
        )}
        {module === "clips" && (
          <SampleClips
            clips={clips}
            selected={clip}
            onSelect={setClip}
            filter={clipFilter}
            onFilter={setClipFilter}
            onRead={(id, read) =>
              setClips((current) =>
                current.map((item) =>
                  item.id === id ? { ...item, read } : item,
                ),
              )
            }
          />
        )}
      </main>
    </div>
    {settings && <SettingsSurface onClose={() => setSettings(false)} returnFocusTo={settingsReturnFocus.current}>
      <SettingsView desktopSurface={!!desktop} sidebarExpanded={sidebarVisible} sampleWorkspace email="" preferences={{ theme, setTheme, motion, setMotion }} onSignOut={() => {}} onExport={() => {}} onErase={() => {}} onDone={() => setSettings(false)} />
    </SettingsSurface>}
    </EditorPreferencesProvider>
  );
}
