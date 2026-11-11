import { useEffect, useState, useRef } from "react";
import type { Note } from "../domain/contracts";
import type {
  LibraryMutationResult,
  NoteVersion,
  NotesLibrary,
} from "../library/contracts";
import { Dialog } from "./primitives";
import { RichEditor } from "./RichEditor";
import { message } from "./model";
import { LibraryActionFeedback, useLibraryAction } from "./libraryAction";
import "../styles/library.css";
import type { EditorNoteLinks } from "./noteLinkViews";
export function VersionHistory({
  note,
  library,
  onClose,
  onResult,
  reload,
  readOnly = false,
  noteLinks,
}: {
  readOnly?: boolean;
  noteLinks?: EditorNoteLinks;
  note: Note;
  library: NotesLibrary;
  onClose: () => void;
  onResult: (result: LibraryMutationResult) => void;
  reload: () => Promise<unknown>;
}) {
  const [versions, setVersions] = useState<NoteVersion[]>([]),
    [selected, setSelected] = useState<NoteVersion | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [confirm, setConfirm] = useState(false);
  const [attempt, setAttempt] = useState(0);
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
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    library
      .history(note.id)
      .then((value) => {
        if (active) setVersions(value);
      })
      .catch((e) => {
        if (active) setError(message(e));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [library, note.id, note.revision, attempt]);
  return (
    <Dialog
      title="Version history"
      className="history-dialog"
      onClose={() => {
        if (!action.busy && !action.error) onClose();
      }}
    >
      <p>
        History starts when this feature was enabled. Up to 50 previous versions
        per note are retained for up to 30 days, within 8 MiB per note and 32
        MiB across the library. Space limits may remove older versions sooner.
      </p>
      {readOnly && (
        <p role="status">
          Repair note links before restoring a version. You can still browse
          history.
        </p>
      )}
      <LibraryActionFeedback action={feedbackAction} reload={reload} />
      {error && (
        <div role="alert">
          <p>{error}</p>
          <button onClick={() => setAttempt((value) => value + 1)}>
            Reload versions
          </button>
        </div>
      )}
      {loading ? (
        <p role="status">Loading versions…</p>
      ) : (
        <div className="version-layout">
          <div className="version-list" aria-label="Saved versions">
            <button aria-pressed={!selected} onClick={() => setSelected(null)}>
              Current version
            </button>
            {versions.map((version) => (
              <button
                key={version.id}
                aria-pressed={selected?.id === version.id}
                onClick={() => {
                  setSelected(version);
                  setConfirm(false);
                }}
              >
                {new Date(version.capturedAt).toLocaleString()}
                <br />
                {version.reason === "history-restore"
                  ? "Before restore"
                  : "Previous edit"}
              </button>
            ))}
            {!versions.length && <p>No previous versions yet.</p>}
          </div>
          <section className="version-preview" aria-label="Version preview">
            <h2>{(selected?.title ?? note.title) || "Untitled note"}</h2>
            <div>
              {(
                selected?.tagsAtCapture ??
                note.tags.map((name) => ({ id: name, name, color: null }))
              ).map((tag) => (
                <span className="tag" key={tag.id}>
                  {tag.name}
                </span>
              ))}
            </div>
            <RichEditor
              documentPolicy="notes"
              noteLinks={
                noteLinks ? { ...noteLinks, interactive: false } : undefined
              }
              key={selected?.id ?? `current-${note.revision}`}
              document={selected?.document ?? note.document}
              onChange={() => {}}
              ariaLabel="Version content"
              readOnly
            />
            {selected && (
              <>
                <p>
                  Restores the title and writing only. Current tags and pin stay
                  unchanged.
                </p>
                <button
                  className="primary"
                  disabled={
                    readOnly ||
                    action.busy ||
                    !!action.error ||
                    !!note.trashedAt
                  }
                  onClick={() => {
                    if (!readOnlyRef.current) setConfirm(true);
                  }}
                >
                  Restore this version
                </button>
              </>
            )}
          </section>
        </div>
      )}
      {confirm && selected && (
        <Dialog
          title="Restore this version?"
          onClose={() => {
            if (!action.busy) setConfirm(false);
          }}
        >
          <p>
            The current title and writing will be kept as a previous version.
            Current tags and pin stay unchanged.
          </p>
          {readOnly && (
            <p role="status">Repair note links before restoring a version.</p>
          )}
          <LibraryActionFeedback action={feedbackAction} reload={reload} />
          <button disabled={action.busy} onClick={() => setConfirm(false)}>
            Cancel
          </button>
          <button
            className="primary"
            disabled={readOnly || action.busy || !!action.error}
            onClick={() => {
              if (readOnlyRef.current) return;
              const id = selected.id,
                revision = note.revision;
              action.start(
                (operationId) => {
                  if (readOnlyRef.current)
                    throw Error(
                      "Repair note links before restoring a version.",
                    );
                  return library.restoreVersion(
                    note.id,
                    id,
                    revision,
                    operationId,
                  );
                },
                (result) => {
                  setConfirm(false);
                  onResult(result);
                  onClose();
                },
              );
            }}
          >
            Restore version
          </button>
        </Dialog>
      )}
    </Dialog>
  );
}
