import { useEffect, useRef, useState } from "react";
import type { Note, NotesStore, NoteDocument } from "../domain/contracts";
import { RichEditor } from "./RichEditor";
import { message, plainText } from "./model";
import { Dialog } from "./primitives";
import { Menu } from "./Menu";
import { Copy, Download, Pencil, Trash2 } from "lucide-react";
export function NoteEditor({
  note,
  store,
  onSaved,
  onBack,
  onTrash,
  onExport,
}: {
  note: Note;
  store: NotesStore;
  onSaved: (n: Note) => void;
  onBack: () => void;
  onTrash: (n: Note) => void;
  onExport: (n: Note) => void;
}) {
  const [draft, setDraft] = useState({
    title: note.title,
    document: note.document,
    tags: note.tags,
  });
  const [tagInput, setTagInput] = useState(note.tags.join(", "));
  const base = useRef(note);
  const latest = useRef(draft);
  const generation = useRef(0);
  const saving = useRef(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState<Note | null>(null);
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);
  const [navigationNotice, setNavigationNotice] = useState("");
  const [discardOpen, setDiscardOpen] = useState(false);
  const [copyBusy, setCopyBusy] = useState(false);
  const duplicating = useRef(false);
  const [duplicateBusy, setDuplicateBusy] = useState(false);
  useEffect(() => {
    if (note.revision <= base.current.revision) return;
    if (dirty) {
      setConflict(note);
      setError("A newer saved version is available. Your draft has been kept.");
    } else {
      base.current = note;
      const next = {
        title: note.title,
        document: note.document,
        tags: note.tags,
      };
      latest.current = next;
      setDraft(next);
      setTagInput(note.tags.join(", "));
    }
  }, [note.revision, dirty]);
  function change(patch: Partial<typeof draft>) {
    const next = { ...latest.current, ...patch };
    latest.current = next;
    generation.current++;
    setDraft(next);
    setDirty(true);
    if (!conflict) setError("");
  }
  useEffect(() => {
    if (!dirty || saving.current || conflict || error) return;
    const timer = setTimeout(() => {
      void save();
    }, 450);
    return () => clearTimeout(timer);
  }, [draft, dirty, retry, conflict, error]);
  async function save() {
    if (saving.current) return;
    saving.current = true;
    const version = generation.current;
    const snapshot = latest.current;
    const delayed = setTimeout(() => setBusy(true), 1000);
    try {
      const updated = await store.update(
        note.id,
        snapshot,
        base.current.revision,
      );
      base.current = updated;
      onSaved(updated);
      if (version === generation.current) {
        setDirty(false);
        setNavigationNotice("");
      } else setRetry((v) => v + 1);
    } catch (e) {
      if (typeof e === "object" && e && "current" in e)
        setConflict(e.current as Note);
      setError(message(e));
    } finally {
      clearTimeout(delayed);
      setBusy(false);
      saving.current = false;
    }
  }
  useEffect(() => {
    if (!dirty) return;
    const guard = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [dirty]);
  function leave(action: () => void) {
    if (dirty) {
      setNavigationNotice(
        "Your latest changes are only in this window. Save or copy your text before leaving.",
      );
      return;
    }
    action();
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(
        `${draft.title}\n\n${plainText(draft.document)}`,
      );
    } catch {
      setError("Couldn’t copy text. Select your text and copy it.");
    }
  }
  return (
    <section className="editor-pane">
      <header className="editor-chrome">
        <button onClick={() => leave(onBack)}>← Back to notes</button>
        <span role="status">
          {error
            ? "Couldn’t save"
            : busy
              ? "Saving…"
              : dirty
                ? "Unsaved changes"
                : "Saved in this browser"}
        </span>
        <Menu key={note.id} label="Note menu" actions={[
          { label: "Rename", icon: <Pencil size={14} aria-hidden="true" />, focusAfterSelect: true, onSelect: () => document.getElementById("note-title")?.focus() },
          { label: "Duplicate", icon: <Copy size={14} aria-hidden="true" />, disabled: dirty || duplicateBusy, onSelect: () => {
            if (duplicating.current) return;
            duplicating.current = true;
            setDuplicateBusy(true);
            void store.create({ ...draft, title: `${draft.title || "Untitled note"} (copy)` })
              .then(onSaved).catch(e => setError(message(e)))
              .finally(() => { duplicating.current = false; setDuplicateBusy(false); });
          } },
          { label: "Export Markdown", icon: <Download size={14} aria-hidden="true" />, disabled: dirty, onSelect: () => onExport(base.current) },
          { label: "Move to Trash", icon: <Trash2 size={14} aria-hidden="true" />, danger: true, onSelect: () => leave(() => onTrash(base.current)) },
        ]} />
      </header>
      {navigationNotice && (
        <p className="banner" role="status">
          {navigationNotice}
        </p>
      )}
      {note.trashedAt && (
        <p className="banner">
          This note was moved to Trash in another tab. Keep a copy of your draft
          before leaving.
        </p>
      )}
      {error && (
        <div className="banner error" role="alert">
          <strong>
            {conflict
              ? "This note changed in another tab. Your draft is still here."
              : "Your latest changes are only in this window. Keep it open, copy your text, then try again."}
          </strong>
          <p>{error}</p>
          <button onClick={() => void copy()}>Copy text</button>
          {conflict ? (
            <>
              <button
                disabled={copyBusy}
                onClick={async () => {
                  setCopyBusy(true);
                  const copiedGeneration = generation.current;
                  try {
                    const copyNote = await store.create({
                      ...latest.current,
                      title: `${latest.current.title || "Untitled note"} (conflict copy)`,
                    });
                    onSaved(copyNote);
                    if (copiedGeneration !== generation.current) {
                      setNavigationNotice(
                        "An earlier draft was saved as a copy. Your latest changes are still here.",
                      );
                      return;
                    }
                    setDirty(false);
                    onBack();
                  } catch (e) {
                    setError(message(e));
                  } finally {
                    setCopyBusy(false);
                  }
                }}
              >
                Save draft as a copy
              </button>
              <button
                disabled={copyBusy}
                onClick={() => {
                  setDiscardOpen(true);
                }}
              >
                Use saved version
              </button>
            </>
          ) : (
            <button
              onClick={() => {
                setError("");
                setRetry((v) => v + 1);
              }}
            >
              Try again
            </button>
          )}
        </div>
      )}
      <div className="editor-page">
        <textarea
          id="note-title"
          aria-label="Note title"
          className="note-title"
          rows={2}
          placeholder="Untitled note"
          value={draft.title}
          onChange={(e) => change({ title: e.target.value })}
        />
        <label className="tag-entry">
          Tags
          <input
            aria-label="Note tags, separated by commas"
            value={tagInput}
            onChange={(e) => {
              setTagInput(e.target.value);
              const seen = new Set<string>();
              const tags = e.target.value
                .split(",")
                .map((t) => t.trim())
                .filter((t) => {
                  const key = t.toLocaleLowerCase();
                  if (!key || seen.has(key)) return false;
                  seen.add(key);
                  return true;
                });
              change({ tags });
            }}
            placeholder="Add tags, separated by commas"
          />
        </label>
        <RichEditor
          document={draft.document as NoteDocument}
          onChange={(document) => change({ document })}
        />
      </div>
      {discardOpen && conflict && (
        <Dialog
          title="Discard your unsaved changes?"
          onClose={() => setDiscardOpen(false)}
        >
          <button onClick={() => setDiscardOpen(false)}>Cancel</button>
          <button
            className="primary"
            onClick={() => {
              base.current = conflict;
              setConflict(null);
              setError("");
              setDirty(false);
              setDiscardOpen(false);
              onSaved(conflict);
              onBack();
            }}
          >
            Use saved version
          </button>
        </Dialog>
      )}
    </section>
  );
}
