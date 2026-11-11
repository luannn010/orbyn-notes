import { useLayoutEffect, useRef, useState } from "react";
import type {
  LibraryMutationResult,
  LibrarySnapshot,
  NotesLibrary,
  Tag,
  TagColor,
} from "../library/contracts";
import { registerCloseGuard } from "../desktop/closeGuard";
import { Dialog } from "./primitives";
import { Menu } from "./Menu";
import { LibraryActionFeedback, useLibraryAction } from "./libraryAction";
import "../styles/library.css";
const colors: [string, TagColor][] = [
  ["Neutral", null],
  ["Blue", "#3b82f6"],
  ["Green", "#16a34a"],
  ["Purple", "#a855f7"],
  ["Orange", "#f97316"],
];
type Form = {
  kind: "create" | "rename" | "color" | "merge" | "delete";
  tag: Tag | null;
  name: string;
  color: TagColor;
  target: string;
};
export function TagsView({
  library,
  snapshot,
  onResult,
  reload,
  onOpenTag,
  readOnly = false,
}: {
  readOnly?: boolean;
  library: NotesLibrary;
  snapshot: LibrarySnapshot;
  onResult: (result: LibraryMutationResult) => void;
  reload: () => Promise<unknown>;
  onOpenTag: (name: string) => void;
}) {
  const [form, setForm] = useState<Form | null>(null);
  const [discard, setDiscard] = useState(false);
  const dirty = useRef(false);
  const action = useLibraryAction();
  const readOnlyRef = useRef(readOnly);
  readOnlyRef.current = readOnly;
  const feedbackAction = {
    ...action,
    reloaded: !readOnly && action.reloaded,
    retry: () => {
      if (!readOnlyRef.current) action.retry();
    },
  };
  useLayoutEffect(() => registerCloseGuard(() => !dirty.current), []);
  useLayoutEffect(() => {
    const guard = (e: BeforeUnloadEvent) => {
      if (dirty.current) e.preventDefault();
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, []);
  const active = snapshot.tags
    .filter((tag) => tag.state === "active")
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  function open(kind: Form["kind"], tag: Tag | null = null) {
    if (readOnlyRef.current || action.busy || action.error) return;
    dirty.current = false;
    setForm({
      kind,
      tag,
      name: tag?.name ?? "",
      color: tag?.color ?? null,
      target: "",
    });
  }
  function close() {
    if (action.busy || action.error) return;
    if (dirty.current) setDiscard(true);
    else setForm(null);
  }
  function submit() {
    if (!form || readOnlyRef.current) return;
    const value = { ...form },
      token = { ...snapshot.token };
    action.start(
      (id) => {
        if (readOnlyRef.current)
          throw Error("Repair note links before saving tag changes.");
        if (value.kind === "create")
          return library.createTag(
            { name: value.name, color: value.color },
            token,
            id,
          );
        if (!value.tag) throw new Error("Choose a tag.");
        if (value.kind === "rename")
          return library.renameTag(value.tag.id, value.name, token, id);
        if (value.kind === "color")
          return library.recolorTag(value.tag.id, value.color, token, id);
        if (value.kind === "merge")
          return library.mergeTag(value.tag.id, value.target, token, id);
        return library.deleteTag(value.tag.id, token, id);
      },
      (result) => {
        dirty.current = false;
        setForm(null);
        onResult(result);
      },
    );
  }
  return (
    <section className="library-view" aria-label="Tags">
      <header className="page-heading">
        <div>
          <h1>Tags</h1>
          <span>{active.length} tags</span>
        </div>
        <button
          className="primary"
          disabled={readOnly || action.busy || !!action.error}
          onClick={() => open("create")}
        >
          New tag
        </button>
      </header>
      {readOnly && (
        <p role="status">
          Repair note links before saving tag changes. Your unsubmitted changes
          are kept here.
        </p>
      )}
      <LibraryActionFeedback action={feedbackAction} reload={reload} />
      <div className="tag-table">
        {active.length === 0 && (
          <p className="empty">
            No tags yet. Create a tag to organize your notes.
          </p>
        )}
        {active.map((tag) => {
          const references = snapshot.notes.filter(
            (note) =>
              !note.trashedAt &&
              snapshot.metadata.some(
                (meta) =>
                  meta.noteId === note.id && meta.tagIds.includes(tag.id),
              ),
          );
          const last = references.reduce(
            (latest, note) => Math.max(latest, Date.parse(note.updatedAt)),
            0,
          );
          return (
            <div className="tag-row" key={tag.id}>
              <button onClick={() => onOpenTag(tag.name)}>
                <span
                  className="tag-swatch"
                  style={tag.color ? { background: tag.color } : undefined}
                />
                {tag.name}
              </button>
              <span>
                {references.length} {references.length === 1 ? "note" : "notes"}
              </span>
              <span>
                {last
                  ? `Last used ${new Date(last).toLocaleDateString()}`
                  : "Not used yet"}
              </span>
              <Menu
                label={`Actions for ${tag.name}`}
                actions={(["rename", "color", "merge", "delete"] as const).map(
                  (kind) => ({
                    label: {
                      rename: "Rename tag",
                      color: "Change color",
                      merge: "Merge tag",
                      delete: "Delete tag",
                    }[kind],
                    danger: kind === "delete",
                    disabled:
                      readOnly ||
                      action.busy ||
                      !!action.error ||
                      (kind === "merge" && active.length < 2),
                    onSelect: () => open(kind, tag),
                  }),
                )}
              />
            </div>
          );
        })}
      </div>
      {form && (
        <Dialog
          title={
            {
              create: "New tag",
              rename: "Rename tag",
              color: "Change color",
              merge: "Merge tag",
              delete: "Delete tag",
            }[form.kind]
          }
          onClose={close}
        >
          <div className="library-form">
            {readOnly && (
              <p role="status">
                Repair note links before saving tag changes. Your unsubmitted
                changes are kept here.
              </p>
            )}
            <LibraryActionFeedback action={feedbackAction} reload={reload} />
            {(form.kind === "create" || form.kind === "rename") && (
              <label>
                Name
                <input
                  autoFocus
                  maxLength={100}
                  value={form.name}
                  readOnly={readOnly}
                  disabled={action.busy || !!action.error}
                  onChange={(e) => {
                    if (readOnlyRef.current) return;
                    dirty.current = true;
                    setForm({ ...form, name: e.target.value });
                  }}
                />
              </label>
            )}
            {(form.kind === "create" || form.kind === "color") && (
              <fieldset>
                <legend>Color</legend>
                <div className="tag-colors">
                  {colors.map(([name, color]) => (
                    <button
                      key={name}
                      disabled={readOnly || action.busy || !!action.error}
                      aria-pressed={form.color === color}
                      onClick={() => {
                        if (readOnlyRef.current) return;
                        dirty.current = true;
                        setForm({ ...form, color });
                      }}
                    >
                      <span
                        className="tag-swatch"
                        style={color ? { background: color } : undefined}
                      />
                      {name}
                    </button>
                  ))}
                </div>
              </fieldset>
            )}
            {form.kind === "merge" && (
              <>
                <p>
                  Merge {form.tag?.name} into another tag. Notes keep the target
                  tag; the source tag is removed.
                </p>
                <label>
                  Merge into
                  <select
                    value={form.target}
                    disabled={readOnly || action.busy || !!action.error}
                    onChange={(e) => {
                      if (readOnlyRef.current) return;
                      dirty.current = true;
                      setForm({ ...form, target: e.target.value });
                    }}
                  >
                    <option value="">Choose a tag</option>
                    {active
                      .filter((tag) => tag.id !== form.tag?.id)
                      .map((tag) => (
                        <option key={tag.id} value={tag.id}>
                          {tag.name}
                        </option>
                      ))}
                  </select>
                </label>
              </>
            )}
            {form.kind === "delete" && (
              <p>
                Remove “{form.tag?.name}” from live notes and Trash? This
                removes the tag, not the notes themselves. Historical versions
                keep their captured tag labels.
              </p>
            )}
            <div className="actions">
              <button disabled={action.busy || !!action.error} onClick={close}>
                Cancel
              </button>
              <button
                className={form.kind === "delete" ? "danger" : "primary"}
                disabled={
                  readOnly ||
                  action.busy ||
                  !!action.error ||
                  ((form.kind === "create" || form.kind === "rename") &&
                    !form.name.trim()) ||
                  (form.kind === "merge" && !form.target)
                }
                onClick={submit}
              >
                {action.busy
                  ? "Saving…"
                  : {
                      create: "Create tag",
                      rename: "Save name",
                      color: "Save color",
                      merge: "Merge tags",
                      delete: "Delete tag",
                    }[form.kind]}
              </button>
            </div>
          </div>
        </Dialog>
      )}
      {discard && (
        <Dialog title="Discard tag changes?" onClose={() => setDiscard(false)}>
          <p>Your unsubmitted tag changes will be lost.</p>
          <button onClick={() => setDiscard(false)}>Keep editing</button>
          <button
            className="danger"
            onClick={() => {
              dirty.current = false;
              setDiscard(false);
              setForm(null);
            }}
          >
            Discard changes
          </button>
        </Dialog>
      )}
    </section>
  );
}
