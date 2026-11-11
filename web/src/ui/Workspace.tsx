import { useEffect, useRef, useState } from "react";
import {
  FileText,
  Search,
  Trash2,
  Settings,
  Plus,
  Menu,
  Grid2X2,
  List,
} from "lucide-react";
import type { AccountSession, Note, NotesStore } from "../domain/contracts";
import { parseMarkdown } from "../transfer";
import { projectNotes, plainText, message } from "./model";
import { Dialog, usePreferences } from "./primitives";
import { SettingsView } from "./SettingsView";
import { NoteEditor } from "./NoteEditor";
import { buildDownload } from "./download";
import { useDesktop } from "../desktop/DesktopShell";
import { trackOperation } from "../desktop/closeGuard";
type Imported = ReturnType<typeof parseMarkdown>;
export function Workspace({
  store,
  session,
  onSignOut,
}: {
  store: NotesStore;
  session: AccountSession;
  onSignOut: () => Promise<void>;
}) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [tag, setTag] = useState("");
  const [trash, setTrash] = useState(false);
  const [grid, setGrid] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const desktop = useDesktop();
  const [sidebarHidden, setSidebarHidden] = useState(false);
  const [wide, setWide] = useState(() => matchMedia("(min-width: 900px)").matches);
  const [settings, setSettings] = useState(false);
  const [signOutOpen, setSignOutOpen] = useState(false);
  const [signOutBusy, setSignOutBusy] = useState(false);
  const [signOutError, setSignOutError] = useState("");
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [showLoadingSkeleton, setShowLoadingSkeleton] = useState(false);
  const [notice, setNotice] = useState("");
  const [undo, setUndo] = useState<Note | null>(null);
  const [imports, setImports] = useState<Imported | null>(null);
  const [importing, setImporting] = useState(false);
  const [exportNotes, setExportNotes] = useState<Note[] | null>(null);
  const [archiveExport, setArchiveExport] = useState(false);
  function requestExport(values: Note[], archive = false) {
    setArchiveExport(archive);
    setExportNotes(values);
  }
  const [download, setDownload] = useState<{
    url: string;
    name: string;
  } | null>(null);
  const [erase, setErase] = useState(false);
  const [eraseText, setEraseText] = useState("");
  const [busy, setBusy] = useState(false);
  const [offline, setOffline] = useState(!navigator.onLine);
  const fileRef = useRef<HTMLInputElement>(null);
  const prefs = usePreferences();
  const menuRef = useRef<HTMLButtonElement>(null);
  const settingsReturnFocus = useRef<HTMLElement | null>(null);
  const drawerRef = useRef<HTMLElement>(null);
  const drawerWasOpen = useRef(false);
  useEffect(() => {
    const query = matchMedia("(min-width: 900px)");
    const update = () => { setWide(query.matches); if (query.matches) setDrawer(false); };
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    if (!desktop) return;
    desktop.setNavigation({ expanded: wide ? !sidebarHidden : drawer,
      toggle: () => { if (wide) setSidebarHidden(value => !value); else setDrawer(value => !value); } });
    return () => desktop.setNavigation(null);
  }, [desktop?.setNavigation, wide, sidebarHidden, drawer]);
  useEffect(() => {
    if (loaded) return;
    const timer = setTimeout(() => setShowLoadingSkeleton(true), 400);
    return () => clearTimeout(timer);
  }, [loaded]);
  async function refresh() {
    try {
      setNotes(await store.list());
      setLoaded(true);
    } catch (e) {
      setError(`Couldn’t load notes. ${message(e)}`);
    }
  }
  useEffect(() => {
    let active = true;
    const read = async () => {
      try {
        const list = await store.list();
        if (active) {
          setNotes(list);
          setLoaded(true);
        }
      } catch (e) {
        if (active) setError(`Couldn’t load notes. ${message(e)}`);
      }
    };
    void read();
    const unsub = store.subscribe(() => void read());
    return () => {
      active = false;
      unsub();
    };
  }, [store]);
  useEffect(() => {
    const update = () => setOffline(!navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  useEffect(() => {
    if (!undo) return;
    const timer = setTimeout(() => setUndo(null), 5000);
    return () => clearTimeout(timer);
  }, [undo]);
  useEffect(() => {
    if (!drawer) {
      if (drawerWasOpen.current) {
        drawerWasOpen.current = false;
        (desktop?.navigationRef.current ?? menuRef.current)?.focus();
      }
      return;
    }
    drawerWasOpen.current = true;
    drawerRef.current?.querySelector<HTMLInputElement>("input")?.focus();
    const close = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setDrawer(false);
      }
      if (e.key === "Tab") {
        const controls = Array.from(
          drawerRef.current?.querySelectorAll<HTMLElement>("input,button") ??
            [],
        );
        const first = controls[0],
          last = controls[controls.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [drawer]);
  useEffect(
    () => () => {
      if (download) URL.revokeObjectURL(download.url);
    },
    [download],
  );
  const selectedSnapshot = useRef<Note | undefined>(undefined);
  const current =
    notes.find((n) => n.id === selected) ??
    (selectedSnapshot.current?.id === selected
      ? selectedSnapshot.current
      : undefined);
  if (current) selectedSnapshot.current = current;
  const visible = projectNotes(notes, query, tag, trash);
  const tags = [
    ...new Set(notes.filter((n) => !n.trashedAt).flatMap((n) => n.tags)),
  ].sort();
  const editing = selected !== null && current;
  function navigate(isTrash = false, nextTag = "") {
    if (editing) {
      setNotice(
        "Use Back to notes before changing collections. Your draft stays open.",
      );
      return;
    }
    setTrash(isTrash);
    setTag(nextTag);
    setDrawer(false);
  }
  async function create() {
    try {
      const note = await store.create({
        title: "",
        document: { type: "doc", content: [{ type: "paragraph" }] },
        tags: [],
      });
      setNotes((v) => [note, ...v]);
      setSelected(note.id);
      setTimeout(() => document.getElementById("note-title")?.focus(), 0);
    } catch (e) {
      setError(`Couldn’t create note. ${message(e)}`);
    }
  }
  async function move(note: Note) {
    try {
      const moved = await store.trash(note.id, note.revision);
      setUndo(moved);
      setNotice("Note moved to Trash");
      setSelected(null);
      await refresh();
    } catch (e) {
      setError(message(e));
    }
  }
  async function restore(note: Note) {
    try {
      await store.restore(note.id, note.revision);
      setUndo(null);
      setNotice("Note restored");
      await refresh();
    } catch (e) {
      setError(message(e));
    }
  }
  async function readFiles(files: FileList | null) {
    if (!files) return;
    try {
      const selectedFiles = Array.from(files);
      if (
        selectedFiles.some(
          (f) =>
            !/(\.md|\.markdown)$/i.test(f.name) || f.size > 5 * 1024 * 1024,
        )
      )
        throw new Error("Choose Markdown files smaller than 5 MB each.");
      const content = await Promise.all(
        selectedFiles.map(async (f) => ({
          name: f.name,
          content: await f.text(),
        })),
      );
      setImports(parseMarkdown(content));
    } catch (e) {
      setError(message(e));
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  }
  async function importAll() {
    return trackOperation(importAllNotes);
  }
  async function importAllNotes() {
    if (!imports) return;
    setImporting(true);
    let done = 0;
    try {
      for (const input of imports) {
        setNotice(`Importing ${done} of ${imports.length} notes…`);
        await store.create(input);
        done++;
      }
      setNotice(`Imported ${done} notes`);
      setImports(null);
    } catch (e) {
      setImports(imports.slice(done));
      setError(
        `Imported ${done} of ${imports.length} notes. ${imports.length - done} weren’t imported. ${message(e)}`,
      );
    } finally {
      setImporting(false);
      await refresh();
    }
  }
  function prepareExport() {
    if (!exportNotes) return;
    try {
      const { blob, name } = buildDownload(exportNotes, archiveExport);
      setDownload({ url: URL.createObjectURL(blob), name });
      setExportNotes(null);
      setNotice("Export prepared");
    } catch {
      setError("Couldn’t export notes. Your notes were not changed.");
    }
  }
  if (!loaded && !error)
    return (
      <main className="loading" aria-label="Loading notes" aria-busy="true">
        {showLoadingSkeleton && <div className="skeleton" />}
      </main>
    );
  return (
    <div className={desktop && wide && sidebarHidden ? "app desktop-sidebar-hidden" : "app"}>
      <a className="skip" href="#main">
        Skip to notes
      </a>
      <header className="mobile-header" inert={drawer}>
        <button
          ref={menuRef}
          aria-label="Open navigation"
          aria-expanded={drawer}
          onClick={() => setDrawer(!drawer)}
        >
          <Menu size={18} />
        </button>
        <b>Orbyn Notes</b>
        <span>Beta · Local only</span>
      </header>
      {drawer && (
        <button
          className="scrim"
          aria-label="Close navigation"
          onClick={() => {
            setDrawer(false);
          }}
        />
      )}
      <aside
        id="notes-sidebar"
        ref={drawerRef}
        role={drawer ? "dialog" : undefined}
        aria-modal={drawer ? true : undefined}
        className={drawer ? "sidebar open" : "sidebar"}
        aria-label="Notes navigation"
      >
        <div className="identity">
          <b>
            Orbyn Notes <small>Beta</small>
          </b>
          <span title={session.email}>{session.email}</span>
        </div>
        <label className="search">
          <Search size={15} />
          <input
            aria-label="Search notes"
            placeholder="Search notes"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <nav>
          <button
            className={!trash && !tag ? "nav active" : "nav"}
            onClick={() => navigate()}
          >
            <FileText size={15} />
            All notes <span>{notes.filter((n) => !n.trashedAt).length}</span>
          </button>
          <p className="group">Tags</p>
          {tags.map((t) => (
            <button
              key={t}
              className={tag === t ? "nav active" : "nav"}
              onClick={() => navigate(false, t)}
            >
              # {t}
              <span>
                {notes.filter((n) => !n.trashedAt && n.tags.includes(t)).length}
              </span>
            </button>
          ))}
          <button
            className={trash ? "nav active" : "nav"}
            onClick={() => navigate(true)}
          >
            <Trash2 size={15} />
            Trash<span>{notes.filter((n) => n.trashedAt).length}</span>
          </button>
        </nav>
        <footer>
          <p title="Notes stay encrypted in this browser. This beta does not sync.">
            ◉ Local only
          </p>
          <button
            className="nav"
            onClick={(event) => {
              if (editing) {
                setNotice("Use Back to notes before opening Settings.");
                return;
              }
              settingsReturnFocus.current = drawer
                ? (desktop?.navigationRef.current ?? menuRef.current)
                : event.currentTarget;
              setSettings(true);
              setDrawer(false);
            }}
          >
            <Settings size={15} />
            Settings
          </button>
        </footer>
      </aside>
      <main id="main" className="sheet" inert={drawer}>
        {offline && (
          <p className="banner">
            You’re offline. Notes still saves in this browser. This beta does
            not sync.
          </p>
        )}
        {error && (
          <div role="alert" className="banner error">
            {error}
            <button
              onClick={() => {
                setError("");
                void refresh();
              }}
            >
              Try again
            </button>
            <button onClick={() => setError("")}>Dismiss</button>
          </div>
        )}
        {notice && (
          <div role="status" className="notice">
            {notice}
            {undo && <button onClick={() => void restore(undo)}>Undo</button>}
            {download && (
              <a href={download.url} download={download.name}>
                Download {notice === "Export prepared" ? "" : "again"}
              </a>
            )}
            <button
              aria-label="Dismiss notification"
              onClick={() => setNotice("")}
            >
              ×
            </button>
          </div>
        )}
        {editing ? (
          <NoteEditor
            key={current.id}
            note={current}
            store={store}
            onSaved={(n) =>
              setNotes((v) => [n, ...v.filter((x) => x.id !== n.id)])
            }
            onBack={() => setSelected(null)}
            onTrash={(n) => void move(n)}
            onExport={(n) => requestExport([n])}
          />
        ) : (
          <>
            <header className="page-heading">
              <div>
                <h1>
                  {trash
                    ? "Trash"
                    : tag
                      ? `# ${tag}`
                      : query
                        ? "Search results"
                        : "All notes"}
                </h1>
                <span>
                  {visible.length} {visible.length === 1 ? "note" : "notes"} ·
                  Edited
                </span>
              </div>
              <div className="actions">
                {!trash && (
                  <>
                    <button
                      aria-label="List view"
                      aria-pressed={!grid}
                      onClick={() => setGrid(false)}
                    >
                      <List size={16} />
                    </button>
                    <button
                      aria-label="Grid view"
                      aria-pressed={grid}
                      onClick={() => setGrid(true)}
                    >
                      <Grid2X2 size={16} />
                    </button>
                    <button
                      disabled={importing}
                      onClick={() => fileRef.current?.click()}
                    >
                      Import Markdown
                    </button>
                    <button className="primary" onClick={() => void create()}>
                      <Plus size={15} />
                      New note
                    </button>
                  </>
                )}
              </div>
            </header>
            {loaded && notes.length === 0 && (
              <div className="welcome banner">
                <strong>Your notes stay in this browser</strong>
                <p>
                  This beta saves encrypted notes on this browser only. It does
                  not sync or back them up. Clearing this site’s data removes
                  them. Export a copy before you clear browser data or change
                  devices.
                </p>
              </div>
            )}
            {!loaded ? (
              <p className="empty">Loading notes…</p>
            ) : visible.length === 0 ? (
              <section className="empty">
                <FileText size={30} />
                <h2>
                  {query
                    ? "No matching notes"
                    : trash
                      ? "Trash is empty"
                      : "No notes yet"}
                </h2>
                <p>
                  {query
                    ? "Try another title, word or tag."
                    : trash
                      ? "Notes you move to Trash appear here."
                      : "Write your first note, or import Markdown files."}
                </p>
                {query ? (
                  <button onClick={() => setQuery("")}>Clear search</button>
                ) : (
                  !trash && (
                    <>
                      <button className="primary" onClick={() => void create()}>
                        Start writing
                      </button>
                      <button onClick={() => fileRef.current?.click()}>
                        Import Markdown
                      </button>
                      <p>Notes are encrypted in this browser.</p>
                    </>
                  )
                )}
              </section>
            ) : (
              <div
                className={
                  grid && !trash ? "note-collection grid" : "note-collection"
                }
              >
                {visible.map((n) => (
                  <article className="note-row" key={n.id}>
                    {trash ? (
                      <>
                        <div>
                          <h2>{n.title || "Untitled note"}</h2>
                          <p>{plainText(n.document).slice(0, 160)}</p>
                        </div>
                        <button onClick={() => void restore(n)}>Restore</button>
                        <button onClick={() => requestExport([n])}>
                          Export Markdown
                        </button>
                      </>
                    ) : (
                      <button
                        className="note-open"
                        onClick={() => setSelected(n.id)}
                      >
                        <h2>{n.title || "Untitled note"}</h2>
                        <p>{plainText(n.document).slice(0, 180)}</p>
                        <div className="metadata">
                          {n.tags.map((t) => (
                            <span className="tag" key={t}>
                              {t}
                            </span>
                          ))}
                          <time dateTime={n.updatedAt}>
                            {new Date(n.updatedAt).toLocaleDateString()}
                          </time>
                        </div>
                      </button>
                    )}
                  </article>
                ))}
              </div>
            )}
          </>
        )}
        <input
          ref={fileRef}
          type="file"
          hidden
          multiple
          accept=".md,.markdown,text/markdown"
          onChange={(e) => void readFiles(e.target.files)}
        />
      </main>
      {settings && (
        <Dialog
          title="Settings"
          className="settings-dialog"
          returnFocusTo={settingsReturnFocus.current}
          onClose={() => setSettings(false)}
        >
          <SettingsView
            email={session.email}
            preferences={prefs}
            onSignOut={() => {
              setSignOutError("");
              setSignOutOpen(true);
            }}
            onExport={() => requestExport(notes, true)}
            onErase={() => setErase(true)}
            onDone={() => setSettings(false)}
          />
        </Dialog>
      )}
      {signOutOpen && (
        <Dialog
          title="Sign out of Notes?"
          onClose={() => {
            if (!signOutBusy) setSignOutOpen(false);
          }}
        >
          <p>
            Your encrypted notes stay in this browser. Sign in to the same
            account in this browser to open them again. They are not backed up
            or synced.
          </p>
          {signOutError && (
            <p className="error" role="alert">
              {signOutError}
            </p>
          )}
          <button disabled={signOutBusy} onClick={() => setSignOutOpen(false)}>
            Cancel
          </button>
          <button
            className="primary"
            disabled={signOutBusy}
            onClick={async () => {
              setSignOutBusy(true);
              setSignOutError("");
              try {
                await onSignOut();
                setSignOutOpen(false);
              } catch {
                setSignOutError("Couldn’t sign out. Try again.");
              } finally {
                setSignOutBusy(false);
              }
            }}
          >
            {signOutBusy ? "Signing out…" : "Sign out"}
          </button>
        </Dialog>
      )}
      {imports && (
        <Dialog
          title="Import Markdown"
          onClose={() => {
            if (!importing) setImports(null);
          }}
        >
          <p>{imports.length} files ready. Original files remain untouched.</p>
          <div className="stack">
            <button
              className="primary"
              disabled={importing}
              onClick={() => void importAll()}
            >
              {importing ? "Importing…" : "Import remaining"}
            </button>
            <button disabled={importing} onClick={() => setImports(null)}>
              Cancel
            </button>
          </div>
        </Dialog>
      )}
      {exportNotes && (
        <Dialog title="Export Markdown" onClose={() => setExportNotes(null)}>
          <p>
            Exported files are readable copies. Anyone with them can read your
            notes.
          </p>
          <button onClick={() => setExportNotes(null)}>Cancel</button>
          <button className="primary" onClick={prepareExport}>
            Export
          </button>
        </Dialog>
      )}
      {erase && (
        <Dialog
          title="Erase notes from this browser?"
          onClose={() => {
            if (!busy) setErase(false);
          }}
        >
          <p>
            This beta has no synced copy. This permanently removes this
            account’s notes and Trash from this browser. Export a copy first.
          </p>
          <div className="stack">
            <button onClick={() => requestExport(notes, true)}>
              Export all notes
            </button>
            <label>
              Type ERASE to confirm
              <input
                value={eraseText}
                onChange={(e) => setEraseText(e.target.value)}
              />
            </label>
            <button
              disabled={busy || eraseText !== "ERASE"}
              className="danger"
              onClick={async () => {
                setBusy(true);
                try {
                  await store.erase();
                  setErase(false);
                  setSettings(false);
                  setEraseText("");
                  setSelected(null);
                  await refresh();
                } catch {
                  setError("Couldn’t erase notes. Try again.");
                } finally {
                  setBusy(false);
                }
              }}
            >
              Erase notes
            </button>
            <button disabled={busy} onClick={() => setErase(false)}>
              Cancel
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
