import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { zipSync, strToU8 } from "fflate";
import type {
  Clip,
  ClipActionInput,
  ClipIntent,
  ClipMutationResult,
  ClipReceipt,
  ClipSnapshot,
  ClipsStore,
} from "../clips/contracts";
import { ClipDuplicateError } from "../clips/contracts";
import { exportClipsFiles } from "../clips/transfer";
import { registerCloseGuard, trackOperation } from "../desktop/closeGuard";
import { Dialog } from "./primitives";
import { message } from "./model";
import { useEditorPreferences } from "./editorPreferences";
import "../styles/clips.css";
import type {
  ClipSearchOpenRequest,
  SearchReaderResult,
} from "./searchNavigation";

type Filter = "all" | "unread" | "later" | "archived";
type Draft = { url: string; title: string; text: string; readLater: boolean };
type Operation = {
  input: ClipActionInput;
  expected: { epoch: string; revision: number };
  intent: ClipIntent | null;
  committing: boolean;
};
type Notice = { text: string; openId?: string; undo?: ClipReceipt };
const emptyDraft = (): Draft => ({
  url: "",
  title: "",
  text: "",
  readLater: false,
});
const host = (url: string) => {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
};
const isConflict = (error: unknown) => {
  const code =
    error && typeof error === "object" && "code" in error
      ? String(error.code)
      : "";
  return [
    "clip_conflict",
    "collections_revision_conflict",
    "clip_stale",
    "clip_intent_revoked",
    "clip_undo_unavailable",
    "clip_operation_reused",
  ].includes(code);
};
export function ClipsView({
  store,
  onOpenExternal,
  openClip,
  onSearchReaderResult,
  accountId,
  holdSearchOrigin = false,
  restoreSearchOrigin = 0,
}: {
  store: ClipsStore;
  onOpenExternal?: (url: string) => Promise<void>;
  openClip?: ClipSearchOpenRequest | null;
  onSearchReaderResult?: SearchReaderResult;
  accountId?: string;
  holdSearchOrigin?: boolean;
  restoreSearchOrigin?: number;
}) {
  useEditorPreferences();
  const [snapshot, setSnapshot] = useState<ClipSnapshot | null>(null),
    [error, setError] = useState(""),
    [closed, setClosed] = useState(false),
    [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>("all"),
    [selected, setSelected] = useState<string | null>(null),
    [form, setForm] = useState(false),
    [draft, setDraft] = useState<Draft>(emptyDraft),
    [discard, setDiscard] = useState<{ openId?: string } | null>(null);
  const [duplicate, setDuplicate] = useState<
      ClipDuplicateError["existing"] | null
    >(null),
    [busy, setBusy] = useState(false),
    [operationError, setOperationError] = useState(""),
    [conflict, setConflict] = useState(false),
    [reloaded, setReloaded] = useState(false),
    [notice, setNotice] = useState<Notice | null>(null);
  const [exportOpen, setExportOpen] = useState(false),
    [exportBusy, setExportBusy] = useState(false),
    [exportError, setExportError] = useState(""),
    [download, setDownload] = useState<{ url: string; name: string } | null>(
      null,
    ),
    [sourceError, setSourceError] = useState(""),
    [offline, setOffline] = useState(!navigator.onLine),
    [clock, setClock] = useState(Date.now());
  const alive = useRef(false),
    generation = useRef(0),
    readSequence = useRef(0),
    current = useRef<ClipSnapshot | null>(null),
    dirty = useRef(false),
    draftRef = useRef<Draft>(emptyDraft()),
    operation = useRef<Operation | null>(null),
    pending = useRef(false),
    exportPending = useRef(false),
    downloadUrl = useRef<string | null>(null);
  const selectionScope = useRef(0),
    selectedId = useRef<string | null>(null);
  function selectClip(id: string | null) {
    selectionScope.current++;
    selectedId.current = id;
    setSelected(id);
    setSourceError("");
  }
  const heldSearchOrigin = useRef<{
      id: string | null;
      filter: Filter;
      epoch: string;
    } | null>(null),
    restoredSearchOrigin = useRef(restoreSearchOrigin);
  useLayoutEffect(() => {
    if (restoredSearchOrigin.current !== restoreSearchOrigin) {
      const origin = heldSearchOrigin.current;
      if (origin && current.current?.epoch === origin.epoch) {
        selectClip(
          origin.id &&
            current.current.clips.items.some((item) => item.id === origin.id)
            ? origin.id
            : null,
        );
        setFilter(origin.filter);
      }
      heldSearchOrigin.current = null;
      restoredSearchOrigin.current = restoreSearchOrigin;
    }
    if (holdSearchOrigin && !heldSearchOrigin.current && current.current)
      heldSearchOrigin.current = {
        id: selectedId.current,
        filter,
        epoch: current.current.epoch,
      };
    if (!holdSearchOrigin) heldSearchOrigin.current = null;
  }, [holdSearchOrigin, restoreSearchOrigin, snapshot?.epoch]);
  const searchAdmission = useRef(0),
    readerResult = useRef(onSearchReaderResult);
  readerResult.current = onSearchReaderResult;
  useEffect(() => {
    const ticket = ++searchAdmission.current;
    if (!openClip) return;
    const request = openClip,
      scope = generation.current;
    if (
      dirty.current ||
      operation.current ||
      pending.current ||
      exportPending.current
    ) {
      readerResult.current?.(request.requestId, "blocked");
      return;
    }
    void trackOperation(() => store.read())
      .then((value) => {
        if (
          !alive.current ||
          ticket !== searchAdmission.current ||
          scope !== generation.current
        )
          return;
        if (
          dirty.current ||
          operation.current ||
          pending.current ||
          exportPending.current
        ) {
          readerResult.current?.(request.requestId, "blocked");
          return;
        }
        if (
          !accountId ||
          accountId !== request.target.accountId ||
          value.epoch !== request.target.collectionsEpoch ||
          !value.clips.items.some((item) => item.id === request.target.clipId)
        ) {
          readerResult.current?.(request.requestId, "unavailable");
          return;
        }
        adopt(value);
        selectClip(request.target.clipId);
        readerResult.current?.(request.requestId, "opened");
      })
      .catch(() => {
        if (
          alive.current &&
          ticket === searchAdmission.current &&
          scope === generation.current
        )
          readerResult.current?.(request.requestId, "unavailable");
      });
    return () => {
      searchAdmission.current++;
    };
  }, [store, accountId, openClip?.requestId]);
  function clearDownload() {
    if (downloadUrl.current) URL.revokeObjectURL(downloadUrl.current);
    downloadUrl.current = null;
    setDownload(null);
  }
  function adopt(value: ClipSnapshot) {
    current.current = value;
    setSnapshot(value);
    setLoading(false);
    setError("");
  }
  async function read(): Promise<ClipSnapshot> {
    const invocation = generation.current,
      sequence = ++readSequence.current;
    const value = await store.read();
    if (!alive.current || invocation !== generation.current)
      throw new Error("Clips is no longer available.");
    if (sequence === readSequence.current) adopt(value);
    return value;
  }
  useLayoutEffect(() => {
    alive.current = true;
    const stopInvalidation = store.onInvalidate((reason) => {
      heldSearchOrigin.current = null;
      generation.current++;
      readSequence.current++;
      current.current = null;
      dirty.current = false;
      draftRef.current = emptyDraft();
      operation.current = null;
      pending.current = false;
      exportPending.current = false;
      const clear = () => {
        clearDownload();
        setSnapshot(null);
        selectClip(null);
        setForm(false);
        setDraft(emptyDraft());
        setDiscard(null);
        setDuplicate(null);
        setOperationError("");
        setConflict(false);
        setReloaded(false);
        setBusy(false);
        setNotice(null);
        setExportOpen(false);
        setExportBusy(false);
        setExportError("");
        setSourceError("");
        setClosed(reason === "closed");
        setLoading(reason !== "closed");
      };
      if (alive.current) flushSync(clear);
      const invalidationGeneration = generation.current;
      if (reason === "epoch")
        queueMicrotask(() => {
          if (alive.current && invalidationGeneration === generation.current)
            refreshQuietly();
        });
    });
    function refreshQuietly() {
      const invocation = generation.current;
      void read().catch((failure) => {
        if (alive.current && invocation === generation.current) {
          setError(message(failure));
          setLoading(false);
        }
      });
    }
    const stop = store.subscribe(refreshQuietly);
    refreshQuietly();
    return () => {
      alive.current = false;
      generation.current++;
      stopInvalidation();
      stop();
      if (downloadUrl.current) URL.revokeObjectURL(downloadUrl.current);
      downloadUrl.current = null;
    };
  }, [store]);
  useLayoutEffect(
    () =>
      registerCloseGuard(() => {
        if (
          dirty.current ||
          operation.current ||
          pending.current ||
          exportPending.current
        ) {
          setNotice({
            text: "Finish or discard your clip draft, and wait for pending actions before leaving.",
          });
          return false;
        }
        return true;
      }),
    [],
  );
  useEffect(() => {
    const unload = (event: BeforeUnloadEvent) => {
      if (
        dirty.current ||
        operation.current ||
        pending.current ||
        exportPending.current
      )
        event.preventDefault();
    };
    window.addEventListener("beforeunload", unload);
    return () => window.removeEventListener("beforeunload", unload);
  }, []);
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
    if (!notice?.undo) return;
    const end = Date.parse(notice.undo.at) + 5000;
    setClock(Date.now());
    const timer = setTimeout(
      () => setClock(Date.now()),
      Math.max(0, end - Date.now() + 1),
    );
    return () => clearTimeout(timer);
  }, [notice]);
  function change(patch: Partial<Draft>) {
    if (operation.current || pending.current) return;
    const next = { ...draftRef.current, ...patch };
    dirty.current = !!(next.url || next.title || next.text || next.readLater);
    draftRef.current = next;
    setDraft(next);
    setOperationError("");
    setDuplicate(null);
  }
  function openForm() {
    if (operation.current || pending.current) return;
    draftRef.current = emptyDraft();
    dirty.current = false;
    setDraft(emptyDraft());
    setDuplicate(null);
    setForm(true);
    setOperationError("");
  }
  function closeForm() {
    if (pending.current) return;
    if (dirty.current || operation.current) setDiscard({});
    else {
      setForm(false);
      setDuplicate(null);
    }
  }
  async function discardForm(openId?: string) {
    if (pending.current) return;
    const invocation = generation.current,
      clickedDraft = draftRef.current;
    pending.current = true;
    setBusy(true);
    try {
      if (openId) {
        const value = await trackOperation(() => read());
        if (
          !alive.current ||
          invocation !== generation.current ||
          draftRef.current !== clickedDraft
        )
          return;
        if (!value.clips.items.some((item) => item.id === openId)) {
          setOperationError(
            "This clip is no longer available. Your draft is still here.",
          );
          setDiscard(null);
          return;
        }
        selectClip(openId);
      }
      operation.current = null;
      dirty.current = false;
      draftRef.current = emptyDraft();
      setDraft(emptyDraft());
      setForm(false);
      setDuplicate(null);
      setDiscard(null);
      setOperationError("");
      setConflict(false);
      setNotice(null);
    } catch (failure) {
      if (alive.current && invocation === generation.current) {
        setOperationError(message(failure));
        setDiscard(null);
      }
    } finally {
      if (alive.current && invocation === generation.current) {
        pending.current = false;
        setBusy(false);
      }
    }
  }
  function success(value: ClipMutationResult, action: ClipActionInput) {
    readSequence.current++;
    adopt(value.snapshot);
    operation.current = null;
    setOperationError("");
    setConflict(false);
    setReloaded(false);
    setClock(Date.now());
    if (action.kind === "create") {
      dirty.current = false;
      draftRef.current = emptyDraft();
      setDraft(emptyDraft());
      setForm(false);
      setDuplicate(null);
      const item = value.snapshot.clips.items.find(
        (item) => item.id === value.receipt.clipId,
      );
      setNotice(
        item
          ? {
              text: item.text === null ? "Link saved" : "Text clip saved",
              openId: item.id,
              undo: value.receipt,
            }
          : {
              text: "The save was confirmed, but this clip is no longer available.",
            },
      );
    } else if (action.kind === "undo-create") {
      setNotice({ text: "Clip save undone" });
      if (selectedId.current === value.receipt.clipId) selectClip(null);
    } else {
      setNotice({
        text: !value.changed
          ? "No changes needed"
          : action.kind === "set-read"
            ? action.read
              ? "Marked read"
              : "Marked unread"
            : action.kind === "set-read-later"
              ? action.readLater
                ? "Added to read later"
                : "Removed from read later"
              : action.archived
                ? "Clip archived"
                : "Clip unarchived",
      });
    }
  }
  async function execute(value: Operation) {
    if (pending.current) return;
    const invocation = generation.current;
    pending.current = true;
    setBusy(true);
    setOperationError("");
    try {
      const result = await trackOperation(async () => {
        if (!value.intent)
          value.intent = await store.prepare(value.expected, value.input);
        if (invocation !== generation.current || !alive.current)
          throw new Error("Clips is no longer available.");
        value.committing = true;
        return store.commit(value.intent);
      });
      if (invocation === generation.current && alive.current)
        success(result, value.input);
    } catch (failure) {
      if (invocation !== generation.current || !alive.current) return;
      if (
        failure instanceof ClipDuplicateError ||
        (failure &&
          typeof failure === "object" &&
          "code" in failure &&
          failure.code === "clip_duplicate")
      ) {
        operation.current = null;
        setDuplicate((failure as ClipDuplicateError).existing);
        setOperationError("");
      } else {
        const knownConflict = isConflict(failure);
        setConflict(knownConflict);
        setReloaded(false);
        setOperationError(message(failure));
        if (!value.committing) operation.current = null;
      }
    } finally {
      if (invocation === generation.current && alive.current) {
        pending.current = false;
        setBusy(false);
      }
    }
  }
  function start(input: ClipActionInput, expected = current.current) {
    if (operation.current || pending.current || !expected) return;
    const value: Operation = {
      input: structuredClone(input),
      expected: { epoch: expected.epoch, revision: expected.revision },
      intent: null,
      committing: false,
    };
    operation.current = value;
    setConflict(false);
    setReloaded(false);
    void execute(value);
  }
  async function save(allowDuplicate = false) {
    if (!current.current || pending.current || operation.current) return;
    const input: ClipActionInput = {
      kind: "create",
      ...structuredClone(draftRef.current),
      allowDuplicate,
    };
    if (!allowDuplicate) {
      start(input);
      return;
    }
    const invocation = generation.current,
      clickedDraft = draftRef.current;
    pending.current = true;
    setBusy(true);
    let handedOff = false;
    try {
      const fresh = await trackOperation(() => read());
      if (
        !alive.current ||
        invocation !== generation.current ||
        draftRef.current !== clickedDraft
      )
        return;
      setDuplicate(null);
      // One synchronous handoff: no edit/click can enter between the read and intent admission.
      pending.current = false;
      handedOff = true;
      start(input, fresh);
    } catch (failure) {
      if (alive.current && invocation === generation.current)
        setOperationError(message(failure));
    } finally {
      if (!handedOff && alive.current && invocation === generation.current) {
        pending.current = false;
        setBusy(false);
      }
    }
  }
  async function reloadAction() {
    const invocation = generation.current,
      value = operation.current;
    try {
      await read();
      if (
        alive.current &&
        invocation === generation.current &&
        value === operation.current
      )
        setReloaded(true);
    } catch (failure) {
      if (invocation === generation.current)
        setOperationError(message(failure));
    }
  }
  function clearConflict() {
    if (pending.current || !reloaded || !conflict) return;
    operation.current = null;
    setOperationError("");
    setConflict(false);
    setReloaded(false);
  }
  async function copy(url: string) {
    const invocation = generation.current,
      selection = selectionScope.current;
    const ownsFeedback = () =>
      alive.current &&
      invocation === generation.current &&
      selection === selectionScope.current;
    try {
      await navigator.clipboard.writeText(url);
      if (ownsFeedback()) {
        setSourceError("");
        setNotice({ text: "Link copied" });
      }
    } catch {
      if (ownsFeedback())
        setSourceError("Couldn’t copy the link. Select the URL and copy it.");
    }
  }
  async function openOriginal(url: string) {
    if (!onOpenExternal) return;
    const invocation = generation.current,
      selection = selectionScope.current;
    const ownsFeedback = () =>
      alive.current &&
      invocation === generation.current &&
      selection === selectionScope.current;
    try {
      await trackOperation(() => onOpenExternal(url));
      if (ownsFeedback()) setSourceError("");
    } catch {
      if (ownsFeedback())
        setSourceError(
          "Couldn’t open the original page. Copy the link and open it in your browser.",
        );
    }
  }
  async function prepareExport() {
    if (exportPending.current) return;
    const invocation = generation.current;
    exportPending.current = true;
    setExportBusy(true);
    setExportError("");
    try {
      await trackOperation(async () => {
        const value = await read();
        const files = exportClipsFiles(value.clips);
        if (
          invocation !== generation.current ||
          !alive.current ||
          value.epoch !== current.current?.epoch
        )
          return;
        if (!files.length) {
          setExportError("There are no clips to export.");
          return;
        }
        const archive: Record<string, Uint8Array> = {};
        for (const file of files)
          archive[file.filename] = strToU8(file.content);
        const blob = new Blob([zipSync(archive) as BlobPart], {
          type: "application/zip",
        });
        if (invocation !== generation.current || !alive.current) return;
        clearDownload();
        const url = URL.createObjectURL(blob);
        downloadUrl.current = url;
        setDownload({ url, name: "orbyn-clips.zip" });
        setExportOpen(false);
        setNotice({ text: "Clips export prepared" });
      });
    } catch (failure) {
      if (invocation === generation.current)
        setExportError(`Couldn’t export clips. ${message(failure)}`);
    } finally {
      if (invocation === generation.current) {
        exportPending.current = false;
        setExportBusy(false);
      }
    }
  }
  const { items, active, unread, visible } = useMemo(() => {
    const items = snapshot?.clips.items ?? [],
      active = items.filter((item) => !item.archivedAt),
      unread = active.filter((item) => !item.readAt).length;
    const visible = items
      .filter((item) =>
        filter === "archived"
          ? !!item.archivedAt
          : !item.archivedAt &&
            (filter !== "unread" || !item.readAt) &&
            (filter !== "later" || item.readLater),
      )
      .sort(
        (a, b) =>
          Date.parse(b.createdAt) - Date.parse(a.createdAt) ||
          a.id.localeCompare(b.id),
      );
    return { items, active, unread, visible };
  }, [snapshot, filter]);
  const item = items.find((item) => item.id === selected),
    undoItem =
      notice?.undo && items.find((item) => item.id === notice.undo!.clipId),
    canUndo = !!(
      notice?.undo &&
      notice.undo.kind === "create" &&
      undoItem?.revision === 1 &&
      clock >= Date.parse(notice.undo.at) &&
      clock < Date.parse(notice.undo.at) + 5000
    );
  const recovery = (
    <>
      {operationError && (
        <div className="banner error" role="alert">
          <p>{operationError}</p>
          {operation.current && (
            <>
              <p>
                {conflict
                  ? "Reload saved clips, then review your action before applying it again."
                  : "The result could not be confirmed. Reload, then retry the same action."}
              </p>
              <button disabled={busy} onClick={() => void reloadAction()}>
                Reload saved clips
              </button>
              {conflict ? (
                <button disabled={!reloaded || busy} onClick={clearConflict}>
                  Keep draft and clear action
                </button>
              ) : (
                <button
                  disabled={!reloaded || busy}
                  onClick={() => {
                    if (operation.current) void execute(operation.current);
                  }}
                >
                  Retry same action
                </button>
              )}
            </>
          )}
        </div>
      )}
    </>
  );
  if (closed)
    return (
      <section className="empty" aria-label="Clips">
        <h1>Clips is no longer available</h1>
        <p>
          Your account or workspace changed. Reopen Clips before making changes.
        </p>
      </section>
    );
  if (!snapshot)
    return (
      <section className="empty" aria-label="Clips" aria-busy={loading}>
        <h1>{error ? "Clips couldn’t open" : "Opening Clips"}</h1>
        {error && (
          <>
            <p role="alert">{error}</p>
            <button
              onClick={() => {
                setLoading(true);
                void read().catch((failure) => {
                  setError(message(failure));
                  setLoading(false);
                });
              }}
            >
              Try again
            </button>
          </>
        )}
      </section>
    );
  return (
    <section className="clips-view" aria-label="Clips">
      <header className="page-heading">
        <div>
          <h1>Clips</h1>
          <span>{unread} unread</span>
        </div>
        <div className="actions">
          <button
            disabled={busy || !!operation.current || exportBusy}
            onClick={() => {
              setExportError("");
              setExportOpen(true);
            }}
          >
            Export Clips
          </button>
          <button
            className="primary"
            disabled={busy || !!operation.current}
            onClick={openForm}
          >
            Save a link
          </button>
        </div>
      </header>
      {offline && (
        <p className="banner">
          You’re offline. Links and pasted text still save on this device.
        </p>
      )}
      {error && (
        <p className="banner error" role="alert">
          Couldn’t refresh clips. {error}
        </p>
      )}
      {!form && recovery}
      {notice && (
        <div className="notice" role="status">
          {notice.text}
          {notice.openId && items.some((item) => item.id === notice.openId) && (
            <button onClick={() => selectClip(notice.openId!)}>
              Open clip
            </button>
          )}
          {canUndo && (
            <button
              disabled={busy || !!operation.current}
              onClick={() =>
                start({
                  kind: "undo-create",
                  receiptOperationId: notice.undo!.operationId,
                  targetRevision: 1,
                })
              }
            >
              Undo
            </button>
          )}
          <button
            aria-label="Dismiss clip notification"
            onClick={() => setNotice(null)}
          >
            ×
          </button>
        </div>
      )}
      {download && (
        <p className="banner">
          <a href={download.url} download={download.name}>
            Download Clips export
          </a>
          <button onClick={clearDownload}>Dismiss download</button>
        </p>
      )}
      <div className="clip-filters" role="group" aria-label="Filter clips">
        {(
          [
            ["all", "All", active.length],
            ["unread", "Unread", unread],
            [
              "later",
              "Read later",
              active.filter((item) => item.readLater).length,
            ],
            [
              "archived",
              "Archived",
              items.filter((item) => item.archivedAt).length,
            ],
          ] as const
        ).map(([key, label, count]) => (
          <button
            key={key}
            aria-pressed={filter === key}
            onClick={() => setFilter(key)}
          >
            {label}
            <span>{count}</span>
          </button>
        ))}
      </div>
      {item ? (
        <article className="clip-reader" key={item.id}>
          <header>
            <button
              onClick={() => {
                selectClip(null);
                setSourceError("");
              }}
            >
              ← Back to clips
            </button>
            <div className="actions">
              <button
                disabled={busy || !!operation.current}
                onClick={() =>
                  start({
                    kind: "set-read",
                    clipId: item.id,
                    targetRevision: item.revision,
                    read: !item.readAt,
                  })
                }
              >
                {item.readAt ? "Mark unread" : "Mark read"}
              </button>
              <button
                disabled={busy || !!operation.current}
                onClick={() =>
                  start({
                    kind: "set-read-later",
                    clipId: item.id,
                    targetRevision: item.revision,
                    readLater: !item.readLater,
                  })
                }
              >
                {item.readLater ? "Remove from read later" : "Read later"}
              </button>
              <button
                disabled={busy || !!operation.current}
                onClick={() =>
                  start({
                    kind: "set-archived",
                    clipId: item.id,
                    targetRevision: item.revision,
                    archived: !item.archivedAt,
                  })
                }
              >
                {item.archivedAt ? "Unarchive" : "Archive"}
              </button>
            </div>
          </header>
          <div className="clip-reader-content">
            <p className="clip-provenance">
              {host(item.originalUrl)} ·{" "}
              {item.text === null ? "Link only" : "Pasted text"} · Saved{" "}
              {new Date(item.createdAt).toLocaleDateString()}
            </p>
            <h2>{item.title}</h2>
            <p className="clip-original">{item.originalUrl}</p>
            <div className="actions">
              {onOpenExternal ? (
                <button onClick={() => void openOriginal(item.originalUrl)}>
                  Open original
                </button>
              ) : (
                <a
                  href={item.originalUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Open original
                </a>
              )}
              <button onClick={() => void copy(item.originalUrl)}>
                Copy link
              </button>
            </div>
            {sourceError && (
              <p role="alert" className="error">
                {sourceError}
              </p>
            )}
            {item.text === null ? (
              <p className="clip-link-only">
                Only the link is saved. Open the original page to read it.
              </p>
            ) : (
              <div className="clip-text">{item.text}</div>
            )}
          </div>
        </article>
      ) : visible.length ? (
        <div className="clip-list">
          {visible.map((clip) => (
            <button
              className="clip-row"
              key={clip.id}
              onClick={() => {
                selectClip(clip.id);
                setSourceError("");
              }}
            >
              <span>
                <strong>{clip.title}</strong>
                <small>
                  {host(clip.originalUrl)} ·{" "}
                  {clip.text === null ? "Link only" : "Text saved"} ·{" "}
                  {new Date(clip.createdAt).toLocaleDateString()}
                </small>
              </span>
              <span className="clip-row-state">
                {clip.readAt ? "Read" : "Unread"}
                {clip.readLater && " · Read later"}
              </span>
            </button>
          ))}
        </div>
      ) : (
        <div className="empty">
          <h2>
            {filter === "archived"
              ? "No archived clips"
              : filter === "unread"
                ? "No unread clips"
                : filter === "later"
                  ? "Nothing in read later"
                  : "No clips yet"}
          </h2>
          <p>
            Save a link and any text you want to keep. Orbyn does not fetch the
            page in this version.
          </p>
          <button onClick={openForm} disabled={busy || !!operation.current}>
            Save a link
          </button>
        </div>
      )}
      {form && (
        <Dialog
          title={duplicate ? "Already saved" : "Save a link"}
          onClose={closeForm}
        >
          <div className="clip-form">
            <p>
              The link and any text you paste are saved on this device. Orbyn
              does not fetch the page in this version.
            </p>
            <label>
              URL
              <input
                aria-label="Clip URL"
                autoFocus
                value={draft.url}
                disabled={busy || !!operation.current || !!duplicate}
                onChange={(event) => change({ url: event.target.value })}
              />
            </label>
            <label>
              Title (optional)
              <input
                value={draft.title}
                maxLength={300}
                disabled={busy || !!operation.current || !!duplicate}
                onChange={(event) => change({ title: event.target.value })}
              />
            </label>
            <label>
              Selected text (optional)
              <textarea
                value={draft.text}
                rows={6}
                disabled={busy || !!operation.current || !!duplicate}
                onChange={(event) => change({ text: event.target.value })}
              />
            </label>
            <p className="clip-form-help">
              One URL up to 8,192 characters; pasted text up to 100,000
              characters.
            </p>
            <label className="clip-checkbox">
              <input
                type="checkbox"
                checked={draft.readLater}
                disabled={busy || !!operation.current || !!duplicate}
                onChange={(event) =>
                  change({ readLater: event.target.checked })
                }
              />
              Read later
            </label>
            {recovery}
            {duplicate && (
              <div role="status">
                <p>
                  “{duplicate.title}” was saved{" "}
                  {new Date(duplicate.createdAt).toLocaleDateString()}
                  {duplicate.archivedAt ? " and is archived" : ""}.
                </p>
                <p>Your new text has not been saved.</p>
              </div>
            )}
            <div className="actions">
              <button disabled={busy} onClick={closeForm}>
                Cancel
              </button>
              {duplicate ? (
                <>
                  <button
                    disabled={busy}
                    onClick={() => {
                      if (pending.current) return;
                      setDuplicate(null);
                      setOperationError("");
                    }}
                  >
                    Back to draft
                  </button>
                  <button
                    disabled={busy}
                    onClick={() => setDiscard({ openId: duplicate.id })}
                  >
                    Open clip
                  </button>
                  <button
                    className="primary"
                    disabled={busy}
                    onClick={() => void save(true)}
                  >
                    Save again
                  </button>
                </>
              ) : (
                <button
                  className="primary"
                  disabled={busy || !!operation.current || !draft.url}
                  onClick={() => void save()}
                >
                  {busy ? "Saving…" : "Save link"}
                </button>
              )}
            </div>
          </div>
        </Dialog>
      )}
      {discard && (
        <Dialog
          title={
            discard.openId
              ? "Open saved clip and discard this draft?"
              : "Discard clip draft?"
          }
          onClose={() => {
            if (!pending.current) setDiscard(null);
          }}
        >
          <p>
            Your unsubmitted link and pasted text will be lost.
            {operation.current &&
              " The earlier save result is unconfirmed; the clip may already be saved. This does not delete a saved clip."}
          </p>
          <button
            disabled={busy}
            onClick={() => {
              if (!pending.current) setDiscard(null);
            }}
          >
            Keep editing
          </button>
          <button
            className="danger"
            disabled={busy}
            onClick={() => void discardForm(discard.openId)}
          >
            {discard.openId ? "Discard draft and open" : "Discard changes"}
          </button>
        </Dialog>
      )}
      {exportOpen && (
        <Dialog
          title="Export Clips"
          onClose={() => {
            if (!exportPending.current) setExportOpen(false);
          }}
        >
          <p>
            Exported files are readable copies. Anyone with them can read your
            saved links and pasted text.
          </p>
          <p>
            Includes complete JSON and readable text with source and state.
            Clips import and automatic restore are not available yet.
          </p>
          {exportError && (
            <p role="alert" className="error">
              {exportError}
            </p>
          )}
          <button disabled={exportBusy} onClick={() => setExportOpen(false)}>
            Cancel
          </button>
          <button
            className="primary"
            disabled={exportBusy}
            onClick={() => void prepareExport()}
          >
            {exportBusy ? "Preparing…" : "Export"}
          </button>
        </Dialog>
      )}
    </section>
  );
}
