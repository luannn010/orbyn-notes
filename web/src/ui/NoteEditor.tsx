import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal, flushSync } from "react-dom";
import { registerCloseGuard, trackOperation } from "../desktop/closeGuard";
import { useDesktop } from "../desktop/DesktopShell";
import type { Tag } from "../library/contracts";
import type { Note, NotesStore, NoteDocument } from "../domain/contracts";
import type { EditorChangeTrace, EditorSourceCapture } from "./RichEditor";
import type { NotesLibrary } from "../library/contracts";
import type {
  SourceAwareNoteUpdate,
  SavedNoteSelection,
} from "../study/sourceContracts";
import {
  canonicalSourceDocument,
  fingerprintSourceDocument,
  verifySourceEdit,
  SourceCodecError,
} from "../study/sourceCodec";
import { SourceCardComposer, SourceCardNotice } from "./SourceCardComposer";
import type { SourceCardOwners } from "./SourceCardComposer";
import type {
  MakeCardResult,
  SourceAnnotation,
} from "../study/sourceContracts";
import type { EditorSourceTarget } from "./RichEditor";
import { RichEditor } from "./RichEditor";
import { message, plainText } from "./model";
import { Dialog } from "./primitives";
import { Menu } from "./Menu";
import { Copy, Download, Pencil, Trash2 } from "lucide-react";
import type { EditorNoteLinks } from "./noteLinkViews";
import { NoteLinksPanel } from "./NoteLinksPanel";
import { encodeNoteReference } from "../links/reference";
import type { NoteLinkCopyFormatter } from "../links/navigation";
import { NoteLinkError } from "../links/contracts";
export function NoteEditor({
  note,
  store,
  onSaved,
  onBack,
  onTrash,
  onExport,
  readOnly = false,
  pinned = false,
  onPin,
  onHistory,
  tagCatalog,
  sourceWriter,
  sourceLibrary,
  source,
  noteLinks,
  formatNoteLink,
  active = true,
}: {
  active?: boolean;
  formatNoteLink?: NoteLinkCopyFormatter;
  noteLinks?: EditorNoteLinks;
  source?: SourceCardOwners & {
    target?: EditorSourceTarget | null;
    onTargetUnavailable?: () => void;
    onOpenCard: (entryId: string) => void;
  };
  sourceWriter?: SourceAwareNoteUpdate;
  sourceLibrary?: NotesLibrary;
  tagCatalog?: Tag[];
  readOnly?: boolean;
  pinned?: boolean;
  onPin?: () => void;
  onHistory?: () => void;
  note: Note;
  store: NotesStore;
  onSaved: (n: Note) => void;
  onBack: () => void;
  onTrash: (n: Note) => void;
  onExport: (n: Note) => void;
}) {
  const titleInput = useRef<HTMLTextAreaElement>(null);
  const [linksOpen, setLinksOpen] = useState(false);
  const linksCanClose = useRef<() => boolean>(() => true);
  const linksRequestClose = useRef(() => {});
  const linksReturnFocus = useRef<HTMLElement | null>(null);
  const [linkCopyNotice, setLinkCopyNotice] = useState("");
  const linkCopySequence = useRef(0);
  useEffect(() => {
    const stop = noteLinks?.service.onInvalidate(() => {
      linkCopySequence.current++;
      setLinkCopyNotice("");
    });
    return () => {
      linkCopySequence.current++;
      stop?.();
    };
  }, [note.id, noteLinks?.service]);
  async function copyNoteReference() {
    if (!noteLinks) return;
    const ticket = ++linkCopySequence.current;
    try {
      const ref = await noteLinks.service.reference(note.id);
      const formatted = formatNoteLink?.(ref.target) ?? {
        text: encodeNoteReference(ref.target),
        kind: "local-reference" as const,
      };
      if (ticket !== linkCopySequence.current) return;
      await navigator.clipboard.writeText(formatted.text);
      if (ticket === linkCopySequence.current)
        setLinkCopyNotice(
          formatted.kind === "local-reference"
            ? "Local reference copied"
            : "Link copied",
        );
    } catch (failure) {
      if (ticket === linkCopySequence.current)
        setLinkCopyNotice(
          failure instanceof NoteLinkError &&
            [
              "note_link_reference_too_large",
              "note_link_reference_unencodable",
            ].includes(failure.code)
            ? "This note can’t be copied as a link. You can still open it here."
            : "Couldn’t copy the link. Try again.",
        );
    }
  }
  const [sourceCapture, setSourceCapture] =
      useState<EditorSourceCapture | null>(null),
    [sourceStale, setSourceStale] = useState(false),
    [sourceReselect, setSourceReselect] = useState(false),
    [annotations, setAnnotations] = useState<SourceAnnotation[]>([]),
    [sourceNotice, setSourceNotice] = useState<MakeCardResult | null>(null),
    [sourceError, setSourceError] = useState("");
  const sourceIntent = useRef(false);
  const pendingSourceRestore = useRef<{
    capture: EditorSourceCapture;
    noteId: string;
    service: SourceCardOwners["service"];
  } | null>(null);
  // RichEditor applies editability in its child layout effect. Restore only
  // after the composer is removed in that same committed tree.
  useLayoutEffect(() => {
    const pending = pendingSourceRestore.current;
    if (!pending) return;
    pendingSourceRestore.current = null;
    if (
      !sourceCapture &&
      active &&
      !readOnly &&
      pending.noteId === note.id &&
      pending.service === source?.service &&
      pending.capture.isCurrent()
    )
      pending.capture.restore();
  });
  const sourceTargets = useMemo(
    () => annotations.map((item) => ({ key: item.entryId, ...item })),
    [annotations],
  );
  useEffect(() => {
    if (!source) {
      setAnnotations([]);
      return;
    }
    let active = true,
      sequence = 0;
    const read = () => {
      const request = ++sequence;
      void source.service
        .annotations(note.id)
        .then((value) => {
          if (active && request === sequence) {
            setAnnotations(value);
            setSourceError("");
          }
        })
        .catch(() => {
          if (active && request === sequence)
            setSourceError(
              "Couldn’t load linked passages. Your note was not changed.",
            );
        });
    };
    const stopInvalidation = source.service.onInvalidate(() => {
      sequence++;
      sourceIntent.current = false;
      pendingSourceRestore.current = null;
      if (active)
        flushSync(() => {
          setSourceCapture(null);
          setSourceNotice(null);
          setAnnotations([]);
          setSourceError("");
        });
    });
    const stop = source.service.subscribe(read);
    read();
    return () => {
      active = false;
      sequence++;
      stopInvalidation();
      stop();
    };
  }, [source?.service, note.id]);
  const [draft, setDraft] = useState({
    title: note.title,
    document: note.document,
    tags: note.tags,
  });
  const [tagInput, setTagInput] = useState("");
  const tagDraftRef = useRef("");
  const stepBatches = useRef<
      { id: number; before: NoteDocument; steps: readonly unknown[] }[]
    >([]),
    stepNumber = useRef(0),
    traceGap = useRef(false);
  const activeSave = useRef<Promise<void> | null>(null);
  const [replacementOpen, setReplacementOpen] = useState(false),
    [sourceLimit, setSourceLimit] = useState(false);
  const base = useRef(note);
  const latest = useRef(draft);
  const generation = useRef(0);
  const saving = useRef(false);
  const [dirty, setDirty] = useState(false);
  const dirtyRef = useRef(false);
  const copyInFlight = useRef(false);
  const desktop = useDesktop();
  const [error, setError] = useState("");
  const [copyError, setCopyError] = useState("");
  const [conflict, setConflict] = useState<Note | null>(null);
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);
  const [navigationNotice, setNavigationNotice] = useState("");
  const [discardOpen, setDiscardOpen] = useState(false);
  const [copyBusy, setCopyBusy] = useState(false);
  const duplicating = useRef(false);
  const [duplicateBusy, setDuplicateBusy] = useState(false);
  useLayoutEffect(
    () =>
      registerCloseGuard(() => {
        if (
          sourceIntent.current ||
          tagDraftRef.current.trim() ||
          dirtyRef.current ||
          saving.current ||
          duplicating.current ||
          copyInFlight.current
        ) {
          setNavigationNotice(
            tagDraftRef.current.trim()
              ? "Add or clear the new tag before leaving."
              : "Your latest changes are only in this window. Save or copy your text before leaving.",
          );
          return false;
        }
        return true;
      }),
    [],
  );
  useEffect(() => {
    if (note.revision <= base.current.revision) return;
    if (dirty) {
      setConflict(note);
      setError("A newer saved version is available. Your draft has been kept.");
    } else {
      if (sourceIntent.current) setSourceStale(true);
      base.current = note;
      const next = {
        title: note.title,
        document: note.document,
        tags: note.tags,
      };
      latest.current = next;
      stepBatches.current = [];
      traceGap.current = false;
      setDraft(next);
    }
  }, [note.revision, dirty]);
  function addTag() {
    if (readOnly) return;
    const name = tagDraftRef.current.trim();
    if (!name) return;
    tagDraftRef.current = "";
    setTagInput("");
    if (!latest.current.tags.includes(name))
      change({ tags: [...latest.current.tags, name] });
  }
  function change(patch: Partial<typeof draft>, trace?: EditorChangeTrace) {
    if (readOnly) return;
    if (patch.document) {
      if (trace)
        stepBatches.current.push({
          id: ++stepNumber.current,
          before: structuredClone(trace.before),
          steps: structuredClone(trace.steps),
        });
      else traceGap.current = true;
    }
    const next = { ...latest.current, ...patch };
    latest.current = next;
    generation.current++;
    dirtyRef.current = true;
    setDraft(next);
    setDirty(true);
    if (!conflict) setError("");
  }
  useEffect(() => {
    if (readOnly || !dirty || saving.current || conflict || error) return;
    const timer = setTimeout(() => {
      void save();
    }, 450);
    return () => clearTimeout(timer);
  }, [draft, dirty, retry, conflict, error]);
  function save(replacement = false): Promise<void> {
    if (activeSave.current) return activeSave.current;
    const task = performSave(replacement);
    activeSave.current = task;
    void task.finally(() => {
      if (activeSave.current === task) activeSave.current = null;
    });
    return task;
  }
  async function performSave(replacement = false) {
    if (readOnly) return;
    if (saving.current) return;
    saving.current = true;
    const version = generation.current;
    const snapshot = structuredClone(latest.current),
      savedBase = structuredClone(base.current);
    const batches = [...stepBatches.current],
      lastBatch = batches.at(-1)?.id ?? 0;
    const delayed = setTimeout(() => setBusy(true), 1000);
    try {
      const updated = await trackOperation(async () => {
        if (sourceWriter && !replacement) {
          if (traceGap.current)
            throw new SourceCodecError("source_codec_invalid");
          if (
            batches.length &&
            canonicalSourceDocument(batches[0]!.before).canonicalJSON !==
              canonicalSourceDocument(savedBase.document).canonicalJSON
          )
            throw new SourceCodecError("source_codec_invalid");
          const steps = batches.flatMap((batch) => [...batch.steps]);
          verifySourceEdit(savedBase.document, snapshot.document, steps);
          const [before, after] = await Promise.all([
            fingerprintSourceDocument(savedBase.document),
            fingerprintSourceDocument(snapshot.document),
          ]);
          return sourceWriter(note.id, snapshot, savedBase.revision, {
            baseDigest: before.digest,
            finalDigest: after.digest,
            steps,
          });
        }
        if (replacement) {
          if (!sourceLibrary)
            throw new Error(
              "A verified replacement writer is unavailable. Copy your text before trying again.",
            );
          return sourceLibrary.replaceDocument(
            note.id,
            snapshot,
            savedBase.revision,
          );
        }
        return store.update(note.id, snapshot, savedBase.revision);
      });
      stepBatches.current = stepBatches.current.filter(
        (batch) => batch.id > lastBatch,
      );
      if (replacement) traceGap.current = false;
      setSourceLimit(false);
      base.current = updated;
      onSaved(updated);
      if (version === generation.current) {
        dirtyRef.current = false;
        setDirty(false);
        setNavigationNotice("");
      } else setRetry((v) => v + 1);
    } catch (e) {
      if (typeof e === "object" && e && "current" in e)
        setConflict(e.current as Note);
      setSourceLimit(
        !!e &&
          typeof e === "object" &&
          "code" in e &&
          (e.code === "source_codec_limit" || e.code === "source_limit"),
      );
      setError(message(e));
    } finally {
      clearTimeout(delayed);
      setBusy(false);
      saving.current = false;
    }
  }
  async function flushSavedSelection(
    capture: EditorSourceCapture,
  ): Promise<SavedNoteSelection> {
    if (!sourceWriter || !sourceLibrary || !capture.isCurrent())
      throw new Error(
        "This passage changed. Select it again before adding the card.",
      );
    if (tagDraftRef.current.trim())
      throw new Error("Add or clear the new tag before making a card.");
    if (activeSave.current) await activeSave.current;
    if (!capture.isCurrent())
      throw new Error(
        "This passage changed. Select it again before adding the card.",
      );
    if (dirtyRef.current) await save();
    if (dirtyRef.current || saving.current)
      throw new Error(
        "Couldn’t save the selected note. Your card draft has been kept.",
      );
    const admitted = structuredClone(base.current),
      version = generation.current;
    const [fingerprint, library] = await Promise.all([
      fingerprintSourceDocument(admitted.document),
      sourceLibrary.read(),
    ]);
    if (
      !capture.isCurrent() ||
      version !== generation.current ||
      base.current.revision !== admitted.revision ||
      canonicalSourceDocument(capture.document).canonicalJSON !==
        fingerprint.canonicalJSON
    )
      throw new Error(
        "This passage changed. Select it again before adding the card.",
      );
    if (
      library.mode !== "ready" ||
      library.snapshot.notes.find((value) => value.id === admitted.id)
        ?.revision !== admitted.revision
    )
      throw new Error(
        "The saved note changed. Reload it before making a card.",
      );
    return {
      noteId: admitted.id,
      noteRevision: admitted.revision,
      libraryEpoch: library.snapshot.token.epoch,
      fingerprint,
      passage: capture.selection.passage,
    };
  }
  useEffect(() => {
    if (!dirty && !tagInput.trim() && !sourceCapture) return;
    const guard = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [dirty, tagInput, sourceCapture]);
  function leave(action: () => void) {
    if (
      dirty ||
      sourceIntent.current ||
      tagDraftRef.current.trim() ||
      saving.current ||
      duplicating.current ||
      copyInFlight.current
    ) {
      setNavigationNotice(
        tagDraftRef.current.trim()
          ? "Add or clear the new tag before leaving."
          : "Your latest changes are only in this window. Save or copy your text before leaving.",
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
      setCopyError("");
    } catch {
      setCopyError("Couldn’t copy text. Select your text and copy it.");
    }
  }
  const chrome = (
    <header className={desktop ? "desktop-editor-actions" : "editor-chrome"}>
      <button onClick={() => leave(onBack)}>← Back to notes</button>
      <span role="status">
        {error
          ? "Couldn’t save"
          : busy
            ? "Saving…"
            : dirty || !!tagInput.trim()
              ? "Unsaved changes"
              : "Saved in this browser"}
      </span>
      {onHistory && (
        <button
          disabled={dirty || !!tagInput.trim() || readOnly}
          onClick={onHistory}
        >
          Version history
        </button>
      )}
      {noteLinks && (
        <button
          className="note-links-toggle"
          type="button"
          aria-expanded={linksOpen}
          onClick={() => {
            linksReturnFocus.current = document.activeElement as HTMLElement;
            if (linksOpen && !linksCanClose.current()) {
              setNavigationNotice(
                "Finish the pending note-link operation before closing this panel.",
              );
              return;
            }
            if (linksOpen) linksRequestClose.current();
            else setLinksOpen(true);
          }}
        >
          Links and backlinks
        </button>
      )}
      <Menu
        key={note.id}
        label="Note menu"
        actions={[
          ...(noteLinks
            ? [
                {
                  label: "Links and backlinks",
                  onSelect: () => {
                    linksReturnFocus.current =
                      document.querySelector<HTMLElement>(
                        '[aria-label="Note menu"]',
                      );
                    setLinksOpen(true);
                  },
                },
              ]
            : []),
          ...(noteLinks
            ? [
                {
                  label: formatNoteLink
                    ? "Copy link to note"
                    : "Copy local reference",
                  onSelect: () => {
                    void copyNoteReference();
                  },
                },
              ]
            : []),
          ...(onPin
            ? [
                {
                  label: pinned ? "Unpin" : "Pin",
                  disabled: dirty || !!tagInput.trim() || readOnly,
                  onSelect: onPin,
                },
              ]
            : []),
          {
            label: "Rename",
            disabled: readOnly,
            icon: <Pencil size={14} aria-hidden="true" />,
            focusAfterSelect: true,
            onSelect: () => titleInput.current?.focus(),
          },
          {
            label: "Duplicate",
            icon: <Copy size={14} aria-hidden="true" />,
            disabled: readOnly || dirty || !!tagInput.trim() || duplicateBusy,
            onSelect: () => {
              if (duplicating.current) return;
              duplicating.current = true;
              setDuplicateBusy(true);
              void store
                .create({
                  ...draft,
                  title: `${draft.title || "Untitled note"} (copy)`,
                })
                .then(onSaved)
                .catch((e) => setError(message(e)))
                .finally(() => {
                  duplicating.current = false;
                  setDuplicateBusy(false);
                });
            },
          },
          {
            label: "Export Markdown",
            icon: <Download size={14} aria-hidden="true" />,
            disabled: dirty || !!tagInput.trim(),
            onSelect: () => onExport(base.current),
          },
          {
            label: "Move to Trash",
            icon: <Trash2 size={14} aria-hidden="true" />,
            danger: true,
            disabled: readOnly,
            onSelect: () => leave(() => onTrash(base.current)),
          },
        ]}
      />
    </header>
  );
  return (
    <section className="editor-pane">
      {desktop?.toolbar
        ? active
          ? createPortal(chrome, desktop.toolbar)
          : null
        : chrome}
      {navigationNotice && (
        <p className="banner" role="status">
          {navigationNotice}
        </p>
      )}
      {linkCopyNotice && (
        <p role="status" className="banner">
          {linkCopyNotice}
        </p>
      )}
      {linksOpen && noteLinks && (
        <NoteLinksPanel
          canClose={linksCanClose}
          requestClose={linksRequestClose}
          service={noteLinks.service}
          noteId={note.id}
          dirty={dirty}
          onOpen={noteLinks.onOpen}
          onClose={() => {
            setLinksOpen(false);
            requestAnimationFrame(() => {
              if (linksReturnFocus.current?.isConnected)
                linksReturnFocus.current.focus();
            });
          }}
        />
      )}
      {copyError && (
        <p className="banner error" role="alert">
          {copyError}
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
          {sourceLimit && !conflict && (
            <button onClick={() => setReplacementOpen(true)}>
              Save without passage links
            </button>
          )}
          {conflict ? (
            <>
              <button
                disabled={copyBusy || readOnly}
                onClick={async () => {
                  setCopyBusy(true);
                  copyInFlight.current = true;
                  const copiedGeneration = generation.current;
                  try {
                    const copyNote = await store.create({
                      ...latest.current,
                      title: `${latest.current.title || "Untitled note"} (conflict copy)`,
                    });
                    onSaved(copyNote);
                    if (
                      copiedGeneration !== generation.current ||
                      tagDraftRef.current.trim()
                    ) {
                      setNavigationNotice(
                        "An earlier draft was saved as a copy. Your latest changes are still here.",
                      );
                      return;
                    }
                    dirtyRef.current = false;
                    setDirty(false);
                    onBack();
                  } catch (e) {
                    setError(message(e));
                  } finally {
                    copyInFlight.current = false;
                    setCopyBusy(false);
                  }
                }}
              >
                Save draft as a copy
              </button>
              <button
                disabled={copyBusy || readOnly}
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
      {sourceError && (
        <p role="alert" className="banner error">
          {sourceError}
        </p>
      )}
      {sourceReselect && (
        <p role="status" className="banner">
          Select a passage for your card. Your card draft is kept.
          <button onClick={() => setSourceReselect(false)}>
            Return to card draft
          </button>
        </p>
      )}
      <div className="editor-page">
        <textarea
          ref={titleInput}
          id={active ? "note-title" : undefined}
          aria-label="Note title"
          className="note-title"
          rows={2}
          placeholder="Untitled note"
          readOnly={readOnly}
          value={draft.title}
          onChange={(e) => change({ title: e.target.value })}
        />
        <div className="note-tag-chips" aria-label="Current note tags">
          {draft.tags.map((name) => (
            <span className="tag" key={name}>
              {name}
              <button
                type="button"
                aria-label={`Remove tag ${name}`}
                disabled={readOnly}
                onClick={() =>
                  change({
                    tags: latest.current.tags.filter((tag) => tag !== name),
                  })
                }
              >
                ×
              </button>
            </span>
          ))}
        </div>
        <div className="tag-entry new-note-tag">
          <label>
            New tag
            <input
              aria-label="New tag"
              maxLength={100}
              value={tagInput}
              readOnly={readOnly}
              placeholder="One tag name"
              onChange={(event) => {
                tagDraftRef.current = event.target.value;
                setTagInput(event.target.value);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  addTag();
                }
              }}
            />
          </label>
          <button
            type="button"
            disabled={readOnly || !tagInput.trim()}
            onClick={addTag}
          >
            Add tag
          </button>
          {tagInput && (
            <button
              type="button"
              onClick={() => {
                tagDraftRef.current = "";
                setTagInput("");
              }}
            >
              Clear tag input
            </button>
          )}
        </div>
        {tagCatalog && (
          <label className="tag-entry">
            Add existing tag
            <select
              aria-label="Add existing tag"
              value=""
              disabled={readOnly}
              onChange={(event) => {
                const selectedTag = tagCatalog.find(
                  (tag) => tag.id === event.target.value,
                );
                if (
                  !selectedTag ||
                  latest.current.tags.includes(selectedTag.name)
                )
                  return;
                const next = [...latest.current.tags, selectedTag.name];
                change({ tags: next });
              }}
            >
              <option value="">Choose a tag</option>
              {tagCatalog
                .filter((tag) => !draft.tags.includes(tag.name))
                .map((tag) => (
                  <option value={tag.id} key={tag.id}>
                    {tag.name}
                  </option>
                ))}
            </select>
          </label>
        )}
        <RichEditor
          noteLinks={noteLinks}
          documentPolicy="notes"
          readOnly={readOnly || (!!sourceCapture && !sourceReselect)}
          sourceControl={
            source
              ? {
                  noteId: note.id,
                  noteRevision: base.current.revision,
                  annotations: sourceTargets,
                  target: source.target,
                  onCapture: (capture) => {
                    if (readOnly) return;
                    pendingSourceRestore.current = null;
                    sourceIntent.current = true;
                    setSourceCapture(capture);
                    setSourceStale(false);
                    setSourceReselect(false);
                  },
                  onInvalidated: () => {
                    if (sourceCapture) setSourceStale(true);
                  },
                  onTargetUnavailable: source.onTargetUnavailable,
                }
              : undefined
          }
          document={draft.document as NoteDocument}
          traceTransactions
          onChange={(document, trace) => change({ document }, trace)}
        />
      </div>
      {source && sourceCapture && (
        <SourceCardComposer
          owners={source}
          capture={sourceCapture}
          stale={sourceStale}
          hidden={sourceReselect}
          flush={flushSavedSelection}
          onReselect={() => setSourceReselect(true)}
          onClose={(restore) => {
            pendingSourceRestore.current = restore
              ? {
                  capture: sourceCapture,
                  noteId: note.id,
                  service: source.service,
                }
              : null;
            sourceIntent.current = false;
            setSourceCapture(null);
            setSourceReselect(false);
          }}
          onAdded={(result) => {
            pendingSourceRestore.current = null;
            sourceIntent.current = false;
            setSourceCapture(null);
            setSourceReselect(false);
            setSourceNotice(result);
          }}
        />
      )}
      {source && sourceNotice && (
        <SourceCardNotice
          key={sourceNotice.receipt.operationId}
          owners={source}
          result={sourceNotice}
          onClose={() => setSourceNotice(null)}
          onOpen={(entryId) => leave(() => source.onOpenCard(entryId))}
        />
      )}
      {replacementOpen && (
        <Dialog
          title="Save and detach passage links?"
          onClose={() => setReplacementOpen(false)}
        >
          <p>
            This edit exceeds passage-link verification limits. Saving a
            replacement will detach linked passages in this note. Your writing
            will be kept; cards remain in Study without a verified passage
            target.
          </p>
          <button onClick={() => setReplacementOpen(false)}>
            Keep editing
          </button>
          <button
            className="primary"
            onClick={() => {
              setReplacementOpen(false);
              void save(true);
            }}
          >
            Save and detach links
          </button>
        </Dialog>
      )}
      {discardOpen && conflict && (
        <Dialog
          title="Discard your unsaved changes?"
          onClose={() => setDiscardOpen(false)}
        >
          <button onClick={() => setDiscardOpen(false)}>Cancel</button>
          <button
            className="primary"
            onClick={() => {
              tagDraftRef.current = "";
              setTagInput("");
              stepBatches.current = [];
              traceGap.current = false;
              base.current = conflict;
              setConflict(null);
              setError("");
              dirtyRef.current = false;
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
