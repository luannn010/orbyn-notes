import { SearchSourceError } from "../search/contracts";
import {
  createSearchAdmission,
  notesSearchData,
  type SearchOwnerAccess,
  type NotesSearchData,
} from "../search/source";
import { NoteLinkError, NoteLinkConflictError } from "../links/contracts";
import type { NoteLinksRow } from "../links/contracts";
import type {
  LinkOwnerAccess,
  LinkOwnerSnapshot,
  LinkCertificate,
} from "../links/model";
import { sameOwnerState, linkToken } from "../links/model";
import {
  charge,
  inspectLinkDocument,
  scanLinkDocument,
  sameTargets,
  validateLinkRows,
  NOTE_LINK_LIMITS,
} from "../links/scanner";
import type {
  AccountIdentity,
  Note,
  PersistenceState,
} from "../domain/contracts";
import { RevisionConflictError } from "../domain/contracts";
import {
  validateNoteInput as validateInput,
  validateNotes,
} from "../domain/validation";
import { requireSession, onLock, lockVersion } from "../account/session";
import { loadEngine, DeviceKeys, SyncEngine } from "../data/engine";
import {
  readRecord,
  mutateRecord,
  wrappingSecret,
  UNCHANGED_RECORD,
} from "../data/database";
import type { DeviceRecord } from "../data/database";
import {
  COLLECTIONS_ZONE,
  prepareCollectionsErase,
  readCollectionsForTransaction,
  stageCollectionsForTransaction,
} from "../collections/store";
import type { CollectionsState } from "../collections/contracts";
import type {
  SourceOwnerAccess,
  SourceOwnerSnapshot,
} from "../study/sourceContracts";
import { SourceConflictError, SourceError } from "../study/sourceContracts";
import { applySourceCommand, sourceTokens } from "../study/sourceModel";
import {
  canonicalSourceDocument,
  fingerprintSourceDocument,
  verifySourceEdit,
  mapSourcePassage,
  sourceEditCost,
  SOURCE_CODEC_LIMITS,
} from "../study/sourceCodec";
import type {
  LibraryAction,
  LibraryMutationResult,
  LibraryOperationReceipt,
  LibraryState,
  LibraryCommonState,
  LibraryToken,
  NotesLibrary,
  NotesLibraryStore,
} from "./contracts";
import {
  LibraryCapacityError,
  LibraryConflictError,
  LibraryEpochError,
  LibraryReadOnlyError,
} from "./contracts";
import {
  activeTag,
  captureVersion,
  deleteTag,
  emptyLibrary,
  internTag,
  mergeTags,
  removeNotes,
  renameTag,
  retainHistory,
  retainReceipts,
  sameDocument,
  snapshot,
  syncMembership,
} from "./model";
import {
  adopt,
  CORE_ZONE,
  LIBRARY_ZONE,
  readCore,
  readLibraryEnvelope,
  readLibraryCommon,
  stageCore,
  stageLibrary,
} from "./storage";
import {
  color,
  invalid,
  integer,
  LIBRARY_LIMITS,
  noteId,
  object,
  sort,
  tagName,
  token,
  undo,
  uuid,
} from "./validation";

type Context = {
  notes: Note[];
  library: LibraryState | null;
  recoveryCommon: LibraryCommonState | null;
  generation: number;
  rawVersion: 1 | 2 | 3;
  rawIndex: string;
  recordIdentity: { core: string; library: string };
  index: LinkOwnerSnapshot["index"];
  skipWrite: boolean;
  protectedVersion?: string;
  protectedReceipt?: string;
  collections?: CollectionsState;
  sourceWorkUnits?: number;
  sourceEdit?: {
    baseJSON: string;
    finalJSON: string;
    baseDigest: string;
    finalDigest: string;
    steps: readonly unknown[];
  };
};
const searchOwners = new WeakMap<NotesLibrary, SearchOwnerAccess>();
export function notesSearchAdmission(
  notes: NotesLibraryStore,
): SearchOwnerAccess {
  const owner = searchOwners.get(notes.library);
  if (!owner) throw new SearchSourceError("search_source_invalid");
  return owner;
}
const linkOwners = new WeakMap<NotesLibrary, LinkOwnerAccess>();
export function noteLinkOwner(notes: NotesLibraryStore): LinkOwnerAccess {
  const owner = linkOwners.get(notes.library);
  if (!owner) throw new NoteLinkError("note_link_revoked");
  return owner;
}
const sourceOwners = new WeakMap<NotesLibrary, SourceOwnerAccess>();
export function studySourceOwner(notes: NotesLibraryStore): SourceOwnerAccess {
  const owner = sourceOwners.get(notes.library);
  if (!owner)
    throw new SourceError(
      "source_revoked",
      "The real Notes source owner is unavailable.",
    );
  return owner;
}
export async function openNotesStore(
  input: AccountIdentity,
): Promise<NotesLibraryStore> {
  const identity = structuredClone(input),
    openedVersion = lockVersion();
  requireSession(identity.accountId, identity.deviceId);
  let closed = false,
    handleEpoch: string | null = null,
    legacyReadOnly = false;
  let legacyCertificate: LinkCertificate | null = null,
    knownMismatch: {
      epoch: string;
      revision: number;
      rawIndex: string;
    } | null = null;
  let searchAdmission: ReturnType<typeof createSearchAdmission> | null = null;
  let state: PersistenceState = { status: "ready" };
  let channel: BroadcastChannel | null = null;
  const listeners = new Set<() => void>();
  const stopLock = onLock(close);
  function close() {
    if (closed) return;
    closed = true;
    searchAdmission?.close();
    legacyCertificate = null;
    knownMismatch = null;
    stopLock();
    channel?.close();
    listeners.clear();
  }
  function assertOpen() {
    if (closed || lockVersion() !== openedVersion)
      throw new Error("locked: This library is closed.");
    requireSession(identity.accountId, identity.deviceId);
  }
  function notify() {
    if (!closed)
      for (const listener of listeners) {
        try {
          listener();
        } catch {
          /* Observers do not control persistence outcomes. */
        }
      }
  }
  let initial: DeviceRecord;
  try {
    await loadEngine();
    assertOpen();
    const found = await readRecord<DeviceRecord>("devices", identity.email);
    assertOpen();
    if (
      !found ||
      found.accountId !== identity.accountId ||
      found.deviceId !== identity.deviceId
    )
      throw new Error(
        "keys_missing: This browser has no keys for this account.",
      );
    initial = found;
    searchAdmission = createSearchAdmission(
      identity,
      initial.wrapKey,
      assertOpen,
      async () => {
        await access({ project: () => undefined });
      },
    );
    channel =
      typeof BroadcastChannel === "undefined"
        ? null
        : new BroadcastChannel("orbyn-notes-library:" + identity.accountId);
    channel?.addEventListener("message", () => {
      searchAdmission?.unverified();
      notify();
    });
    const ready = await access({
      initialize: true,
      project: (ctx) => (ctx.library ?? ctx.recoveryCommon)?.epoch ?? null,
    });
    handleEpoch = ready;
    legacyReadOnly = ready === null;
  } catch (error) {
    close();
    throw error;
  }

  async function access<T>(options: {
    initialize?: boolean;
    change?: (ctx: Context) => void;
    project: (ctx: Context) => T;
    erase?: boolean;
    legacyErase?: boolean;
    collections?: boolean;
    repair?: boolean;
    beforeStage?: () => void;
  }): Promise<T> {
    // Immutable invocation fence: adopting an erase result must not admit queued old work.
    const operationEpoch = handleEpoch,
      operationLockVersion = lockVersion();
    assertOpen();
    if (options.change && legacyReadOnly && !options.legacyErase)
      throw new LibraryReadOnlyError();
    const secret = await wrappingSecret(initial.wrapKey);
    let result: T | undefined,
      resultingEpoch: string | null = null,
      wrote = false;
    let searchCandidate: {
      record: DeviceRecord;
      before?: DeviceRecord;
      data: NotesSearchData | null;
    } | null = null;
    async function publishSearch() {
      if (searchCandidate && searchAdmission) {
        try {
          await searchAdmission.publish(
            searchCandidate.record,
            searchCandidate.data,
            searchCandidate.before,
          );
        } catch {
          /* Optional search admission never changes a committed Notes outcome. */
        }
      }
    }
    const guard = () => {
      assertOpen();
      if (lockVersion() !== operationLockVersion)
        throw new Error("locked: This library is closed.");
    };
    try {
      guard();
      function apply(
        record: DeviceRecord | undefined,
      ): DeviceRecord | typeof UNCHANGED_RECORD {
        guard();
        if (
          !record ||
          record.accountId !== identity.accountId ||
          record.deviceId !== identity.deviceId
        )
          throw new Error(
            "keys_missing: Account device changed. Sign in again.",
          );
        integer(record.generation);
        const keys = DeviceKeys.import(record.sealedKeys, secret);
        let engine: SyncEngine | undefined;
        try {
          engine = record.snapshot
            ? SyncEngine.restore(keys, record.snapshot, secret, Date.now())
            : SyncEngine.create(keys, record.accountId, record.deviceId);
          const envelope = readLibraryEnvelope(engine),
            header = envelope.value;
          const rawVersion =
            (header as { version?: unknown } | null)?.version ?? 2;
          if (rawVersion !== 1 && rawVersion !== 2 && rawVersion !== 3)
            invalid();
          const core = readCore(engine, rawVersion === 3 ? "notes" : "plain");
          const common = readLibraryCommon(header, core.notes);
          let library: LibraryState | null = null,
            recoveryCommon: LibraryCommonState | null = null;
          const rawIndex =
            rawVersion === 3
              ? (JSON.stringify(
                  (header as { noteLinks?: unknown }).noteLinks,
                ) ?? "<absent>")
              : "<legacy>";
          let index: LinkOwnerSnapshot["index"] = { status: "valid", rows: [] };
          if (rawVersion === 3) {
            try {
              index = {
                status: "valid",
                rows: validateLinkRows(
                  (header as { noteLinks?: unknown }).noteLinks,
                  core.notes,
                ),
              };
            } catch (error) {
              if (!(error instanceof NoteLinkError)) throw error;
              index = { status: "invalid" };
            }
          }
          if (common) {
            if (common.version === 2) library = { ...common, version: 2 };
            else if (index.status === "valid")
              library = { ...common, version: 3, noteLinks: index.rows };
            else recoveryCommon = common;
          }
          if (
            options.change &&
            !options.repair &&
            !options.erase &&
            common &&
            (index.status === "invalid" ||
              (knownMismatch?.epoch === common.epoch &&
                knownMismatch.revision === common.revision &&
                knownMismatch.rawIndex === rawIndex))
          )
            throw new NoteLinkError("note_link_index_invalid");
          const existed = header !== null;
          if (!library && !recoveryCommon && options.initialize) {
            try {
              library = adopt(
                engine,
                core.notes,
                core.original,
                new Date().toISOString(),
              );
            } catch (error) {
              if (!(error instanceof LibraryCapacityError)) throw error;
            }
          }
          if (
            !library &&
            !recoveryCommon &&
            !options.initialize &&
            !legacyReadOnly
          )
            throw new Error(
              "library_missing: Reopen the library before retrying.",
            );
          if (
            options.change &&
            (library ?? recoveryCommon) &&
            operationEpoch !== (library ?? recoveryCommon)!.epoch
          )
            throw new LibraryEpochError();
          const ctx: Context = {
            notes: core.notes,
            library,
            recoveryCommon,
            generation: record.generation,
            rawVersion,
            rawIndex,
            recordIdentity: { core: core.identity, library: envelope.identity },
            index,
            skipWrite: false,
            collections: options.collections
              ? readCollectionsForTransaction(engine)
              : undefined,
          };
          const annotationBases =
            options.change && library?.anchors.length
              ? new Map(
                  core.notes.map((note) => [
                    note.id,
                    { revision: note.revision, document: note.document },
                  ]),
                )
              : null;
          const linkBase =
            options.change && library
              ? new Map(
                  core.notes.map((note) => [
                    note.id,
                    { revision: note.revision, document: note.document },
                  ]),
                )
              : null;
          const linkSnapshot = library ? ownerSnapshot(ctx) : null;
          options.change?.(ctx);
          if (
            options.change &&
            !ctx.skipWrite &&
            ctx.library &&
            !options.repair &&
            !options.erase
          ) {
            const work = { utf8Units: ctx.sourceWorkUnits ?? 0, nodeVisits: 0 };
            if (
              ctx.library.version === 2 &&
              legacyCertificate &&
              linkSnapshot &&
              sameOwnerState(legacyCertificate.snapshot, linkSnapshot)
            ) {
              ctx.library = { ...ctx.library, version: 3, noteLinks: [] };
            }
            if (ctx.library.version === 3) {
              const rows = new Map(
                ctx.library.noteLinks.map((row) => [row.noteId, row]),
              );
              const oldRows = new Map(
                index.status === "valid"
                  ? index.rows.map((row) => [row.noteId, row])
                  : [],
              );
              for (const note of ctx.notes) {
                const before = linkBase?.get(note.id);
                if (
                  before &&
                  before.revision === note.revision &&
                  before.document === note.document
                )
                  continue;
                if (before && before.document !== note.document) {
                  const old = scanLinkDocument(
                    inspectLinkDocument(before.document, "notes", work),
                    work,
                  );
                  if (!sameTargets(old, oldRows.get(note.id)?.targets ?? []))
                    throw new NoteLinkError("note_link_index_invalid");
                }
                if (before && before.document === note.document) {
                  const carried = rows.get(note.id);
                  if (carried) carried.noteRevision = note.revision;
                } else {
                  const targets = scanLinkDocument(
                    inspectLinkDocument(note.document, "notes", work),
                    work,
                  );
                  if (targets.length)
                    rows.set(note.id, {
                      noteId: note.id,
                      noteRevision: note.revision,
                      targets,
                    });
                  else rows.delete(note.id);
                }
              }
              const ids = new Set(ctx.notes.map((note) => note.id));
              ctx.library.noteLinks = [...rows.values()].filter((row) =>
                ids.has(row.noteId),
              );
              validateLinkRows(ctx.library.noteLinks, ctx.notes);
            }
          }
          // Central tag operations revise Notes outside changeNote, but retain
          // the exact same document object. Carry those annotations once here.
          const annotationNotes = annotationBases
            ? new Map(ctx.notes.map((note) => [note.id, note]))
            : null;
          for (const anchor of annotationBases
            ? (ctx.library?.anchors ?? [])
            : []) {
            const base = annotationBases!.get(anchor.noteId),
              note = annotationNotes!.get(anchor.noteId);
            if (
              anchor.status !== "attached" ||
              !base ||
              !note ||
              anchor.noteRevision !== base.revision ||
              note.revision === base.revision
            )
              continue;
            if (anchor.revision >= Number.MAX_SAFE_INTEGER)
              throw new SourceError(
                "source_limit",
                "Source revisions are exhausted.",
              );
            anchor.revision++;
            if (base.document === note.document)
              anchor.noteRevision = note.revision;
            else {
              anchor.status = "stale";
              anchor.staleReason = "document-replaced";
            }
          }
          guard();
          options.beforeStage?.();
          const changed = Boolean(options.change && !ctx.skipWrite);
          if (changed && !ctx.library) throw new LibraryReadOnlyError();
          // Capture the old collections revision while its authenticated owner
          // still exists. Purge and all fresh-key replacements share this IDB put.
          const finishCollectionsErase =
            changed && options.erase ? prepareCollectionsErase(engine) : null;
          if (changed) {
            if (ctx.library!.revision >= Number.MAX_SAFE_INTEGER)
              throw new Error(
                "library_revision_exhausted: Library revisions are exhausted.",
              );
            ctx.library!.revision++;
            retainHistory(ctx.library!, Date.now(), ctx.protectedVersion);
            retainReceipts(ctx.library!, Date.now(), ctx.protectedReceipt);
            if (finishCollectionsErase)
              engine.purgeLocalZones(
                JSON.stringify([CORE_ZONE, COLLECTIONS_ZONE, LIBRARY_ZONE]),
              );
            stageCore(
              engine,
              ctx.notes,
              !options.erase && core.exists,
              ctx.library!.version === 3 ? "notes" : "plain",
            );
          }
          if (
            (changed || (!existed && ctx.library && options.initialize)) &&
            ctx.library
          ) {
            stageLibrary(
              engine,
              ctx.library,
              ctx.notes,
              !options.erase && existed,
            );
            if (changed && ctx.collections)
              stageCollectionsForTransaction(engine, ctx.collections);
            finishCollectionsErase?.();
            wrote = true;
          }
          resultingEpoch = (ctx.library ?? ctx.recoveryCommon)?.epoch ?? null;
          result = structuredClone(options.project(ctx));
          if (wrote && record.generation >= Number.MAX_SAFE_INTEGER)
            throw new Error(
              "device_generation_exhausted: Device generations are exhausted.",
            );
          const nextRecord: DeviceRecord = wrote
            ? {
                ...record,
                snapshot: engine.snapshot(secret),
                generation: record.generation + 1,
              }
            : record;
          const commonState = ctx.library ?? ctx.recoveryCommon;
          if (commonState && searchAdmission)
            searchCandidate = {
              record: nextRecord,
              before: wrote ? record : undefined,
              data: searchAdmission.sameImage(nextRecord)
                ? null
                : notesSearchData(ctx.notes, {
                    epoch: commonState.epoch,
                    revision: commonState.revision,
                  }),
            };
          return wrote ? nextRecord : UNCHANGED_RECORD;
        } finally {
          engine?.free();
          keys.free();
        }
      }
      if (options.change || options.initialize) {
        if (options.change) {
          state = { status: "saving" };
          notify();
        }
        await mutateRecord<DeviceRecord>("devices", identity.email, apply);
        guard();
        if (options.erase && wrote) {
          handleEpoch = resultingEpoch;
          legacyReadOnly = false;
        }
        await publishSearch();
        guard();
        if (options.change) {
          state = { status: "ready" };
          if (wrote) channel?.postMessage("changed");
          notify();
        }
      } else {
        const record = await readRecord<DeviceRecord>(
          "devices",
          identity.email,
        );
        guard();
        apply(record);
        await publishSearch();
      }
      guard();
      return result as T;
    } catch (error) {
      if (options.change && !closed) {
        state = {
          status: "failed",
          message:
            error instanceof Error
              ? error.message
              : "The library could not be saved.",
        };
        notify();
      }
      throw error;
    } finally {
      secret.fill(0);
    }
  }
  function readable(ctx: Context): LibraryCommonState {
    const state = ctx.library ?? ctx.recoveryCommon;
    if (!state) throw new LibraryReadOnlyError();
    return state;
  }
  function writable(ctx: Context): LibraryState {
    if (ctx.recoveryCommon) throw new NoteLinkError("note_link_index_invalid");
    if (!ctx.library) throw new LibraryReadOnlyError();
    return ctx.library;
  }
  function findNote(ctx: Context, id: string): Note {
    const note = ctx.notes.find((note) => note.id === id);
    if (!note) throw new Error("note_missing: This note no longer exists.");
    return note;
  }
  function checkedNote(
    ctx: Context,
    id: string,
    revision: number,
    attempted?: Note,
  ): Note {
    const current = findNote(ctx, id);
    if (current.revision !== revision)
      throw new RevisionConflictError(
        structuredClone(current),
        structuredClone(attempted ?? current),
      );
    return current;
  }
  function changeNote(
    ctx: Context,
    id: string,
    expected: number,
    transform: (note: Note) => Note,
    reason: "edit" | "history-restore" = "edit",
    sourceDisposition: "ordinary" | "replacement" = "ordinary",
  ): Note {
    const library = writable(ctx),
      current = findNote(ctx, id);
    if (current.revision >= Number.MAX_SAFE_INTEGER)
      throw new Error("note_revision_exhausted: Note revisions are exhausted.");
    const attempted = transform({
      ...structuredClone(current),
      revision: expected + 1,
      updatedAt: new Date().toISOString(),
    });
    checkedNote(ctx, id, expected, attempted);
    validateNotes(
      [attempted],
      library.version === 3 || legacyCertificate ? "notes" : "plain",
    );
    const proof = ctx.sourceEdit;
    const documentChanged = !sameDocument(attempted.document, current.document);
    if (
      proof &&
      (canonicalSourceDocument(current.document).canonicalJSON !==
        proof.baseJSON ||
        canonicalSourceDocument(attempted.document).canonicalJSON !==
          proof.finalJSON)
    )
      throw new SourceError(
        "source_stale",
        "The editor proof no longer matches this note.",
      );
    const attached = library.anchors.filter(
      (anchor) => anchor.noteId === id && anchor.status === "attached",
    );
    const edit = proof
      ? verifySourceEdit(current.document, attempted.document, proof.steps)
      : null;
    if (edit) {
      const cost = sourceEditCost(edit);
      // Zero-step metadata carry below does no per-anchor tree/range walk.
      const mappingUnits = cost.stepCount
        ? attached.reduce(
            (sum, anchor) =>
              sum +
              (cost.maxDocumentUnits + (anchor.to - anchor.from) * 2 + 64) *
                (cost.stepCount + 1),
            0,
          )
        : 0;
      const graphUnits =
        documentChanged && (library.version === 3 || legacyCertificate)
          ? (JSON.stringify(current.document).length +
              JSON.stringify(attempted.document).length) *
            6
          : 0;
      ctx.sourceWorkUnits = cost.replayUnits + mappingUnits;
      if (
        cost.replayUnits + mappingUnits + graphUnits >
        SOURCE_CODEC_LIMITS.replayUnits
      )
        throw new SourceError(
          "source_limit",
          "This annotation mapping exceeds its supported work limit.",
        );
    }
    for (const anchor of attached) {
      if (anchor.revision === Number.MAX_SAFE_INTEGER)
        throw new SourceError(
          "source_limit",
          "Source revisions are exhausted.",
        );
      if (
        sourceDisposition !== "replacement" &&
        reason !== "history-restore" &&
        !documentChanged &&
        !proof?.steps.length
      ) {
        anchor.noteRevision = attempted.revision;
        anchor.revision++;
        continue;
      }
      anchor.revision++;
      if (
        !proof ||
        !edit ||
        anchor.documentDigest !== proof.baseDigest ||
        anchor.noteRevision !== current.revision
      ) {
        anchor.status = "stale";
        anchor.staleReason = "document-replaced";
      } else {
        const mapped = mapSourcePassage(edit, {
          from: anchor.from,
          to: anchor.to,
          quote: anchor.quote,
        });
        if (mapped.status === "stale") {
          anchor.status = "stale";
          anchor.staleReason = "passage-edited";
        } else {
          anchor.from = mapped.passage.from;
          anchor.to = mapped.passage.to;
          anchor.documentDigest = proof.finalDigest;
          anchor.noteRevision = attempted.revision;
        }
      }
    }
    if (
      attempted.title !== current.title ||
      !sameDocument(attempted.document, current.document) ||
      reason === "history-restore"
    )
      ctx.protectedVersion = captureVersion(
        library,
        current,
        reason,
        new Date().toISOString(),
      );
    if (!documentChanged) attempted.document = current.document;
    ctx.notes[ctx.notes.findIndex((note) => note.id === id)] = attempted;
    syncMembership(library, attempted, new Date().toISOString());
    return attempted;
  }
  function materialize(
    ctx: Context,
    receipt: LibraryOperationReceipt,
    replayed: boolean,
  ): LibraryMutationResult {
    const state = writable(ctx),
      r = receipt.result;
    const note =
      r.type === "note"
        ? (ctx.notes.find((note) => note.id === r.noteId) ?? null)
        : null;
    const canUndo =
      r.type === "note" &&
      r.undo &&
      note?.revision === r.resultRevision &&
      note.trashedAt === r.undo.resultTrashedAt &&
      Date.now() < Date.parse(r.undo.expiresAt);
    return {
      snapshot: snapshot(state, ctx.notes),
      note: structuredClone(note),
      tag:
        r.type === "tag"
          ? structuredClone(
              state.tags.find((tag) => tag.id === r.tagId) ?? null,
            )
          : null,
      undo: canUndo ? structuredClone(r.type === "note" ? r.undo : null) : null,
      removedCount: r.type === "empty-trash" ? r.removedCount : 0,
      replayed,
    };
  }
  function command(
    kind: LibraryAction,
    args: unknown[],
    operationId: string,
    expected: LibraryToken | null,
    effect: (ctx: Context) => LibraryOperationReceipt["result"],
  ): Promise<LibraryMutationResult> {
    uuid(operationId);
    const serialized = JSON.stringify(args);
    if (serialized.length > 2048) throw new LibraryCapacityError();
    let receipt!: LibraryOperationReceipt,
      replayed = false;
    return access({
      change: (ctx) => {
        const state = writable(ctx),
          previous = state.receipts.find(
            (receipt) => receipt.id === operationId,
          );
        if (previous) {
          if (previous.kind !== kind || previous.arguments !== serialized)
            throw new Error(
              "operation_conflict: This operation identifier was already used.",
            );
          receipt = previous;
          replayed = true;
          ctx.skipWrite = true;
          return;
        }
        if (
          expected &&
          (expected.epoch !== state.epoch ||
            expected.revision !== state.revision)
        )
          throw new LibraryConflictError(snapshot(state, ctx.notes));
        const result = effect(ctx);
        receipt = {
          id: operationId,
          epoch: state.epoch,
          committedAt: new Date().toISOString(),
          libraryRevision: state.revision + 1,
          kind,
          arguments: serialized,
          result,
        };
        state.receipts.push(receipt);
        ctx.protectedReceipt = operationId;
      },
      project: (ctx) => materialize(ctx, receipt, replayed),
    });
  }
  function changeTrash(
    note: string,
    action: "trash" | "restore",
    revision: number,
    operationId: string,
  ): Promise<LibraryMutationResult> {
    noteId(note);
    integer(revision, 1);
    if (action !== "trash" && action !== "restore")
      throw new Error("library_invalid: Invalid trash action.");
    return command(
      action,
      [note, action, revision],
      operationId,
      null,
      (ctx) => {
        const state = writable(ctx),
          before = checkedNote(ctx, note, revision),
          previousTrashedAt = before.trashedAt;
        if (
          action === "trash"
            ? previousTrashedAt !== null
            : previousTrashedAt === null
        )
          throw new Error(
            "trash_state_changed: The note is no longer in the expected place.",
          );
        const moved = changeNote(ctx, note, revision, (current) => ({
          ...current,
          trashedAt: action === "trash" ? new Date().toISOString() : null,
        }));
        return {
          type: "note",
          noteId: note,
          resultRevision: moved.revision,
          undo: {
            epoch: state.epoch,
            operationId,
            noteId: note,
            resultRevision: moved.revision,
            previousTrashedAt,
            resultTrashedAt: moved.trashedAt,
            expiresAt: new Date(
              Date.now() + LIBRARY_LIMITS.undoMs,
            ).toISOString(),
          },
        };
      },
    );
  }
  const library: NotesLibrary = {
    replaceDocument: async (id, input, revision) => {
      noteId(id);
      integer(revision, 1);
      const stable = validateInput(structuredClone(input));
      return access({
        change: (ctx) => {
          changeNote(
            ctx,
            id,
            revision,
            (current) => ({ ...current, ...stable }),
            "edit",
            "replacement",
          );
        },
        project: (ctx) => findNote(ctx, id),
      });
    },
    updateWithSourceSteps: async (id, patch, revision, proof) => {
      const invocationEpoch = handleEpoch;
      noteId(id);
      integer(revision, 1);
      const stable = structuredClone(patch),
        capturedProof = structuredClone(proof);
      const current = await access({ project: (ctx) => findNote(ctx, id) });
      const base = await fingerprintSourceDocument(current.document);
      const final = await fingerprintSourceDocument(
        stable.document ?? current.document,
      );
      assertOpen();
      if (
        capturedProof.baseDigest !== base.digest ||
        capturedProof.finalDigest !== final.digest
      )
        throw new SourceError(
          "source_invalid",
          "The editor proof digest does not match its document.",
        );
      return access({
        change: (ctx) => {
          if (ctx.library?.epoch !== invocationEpoch)
            throw new LibraryEpochError();
          ctx.sourceEdit = {
            baseJSON: base.canonicalJSON,
            finalJSON: final.canonicalJSON,
            baseDigest: base.digest,
            finalDigest: final.digest,
            steps: capturedProof.steps,
          };
          changeNote(ctx, id, revision, (current) => ({
            ...current,
            ...validateInput({
              title: stable.title ?? current.title,
              document: stable.document ?? current.document,
              tags: stable.tags ?? current.tags,
            }),
          }));
        },
        project: (ctx) => findNote(ctx, id),
      });
    },
    read: () =>
      access({
        project: (ctx) =>
          (ctx.library ?? ctx.recoveryCommon)
            ? {
                mode: "ready" as const,
                snapshot: snapshot(readable(ctx), ctx.notes),
              }
            : {
                mode: "legacy-read-only" as const,
                notes: structuredClone(ctx.notes),
                reason: "metadata-limit" as const,
                recovery: {
                  kind: "export-or-confirm-erase" as const,
                  deviceGeneration: ctx.generation,
                },
              },
      }),
    setPinned: async (id, pinned, expectedInput, operationId) => {
      noteId(id);
      if (typeof pinned !== "boolean")
        throw new Error("library_invalid: Invalid pin state.");
      const expected = token(expectedInput);
      return command(
        "pin",
        [id, pinned, expected],
        operationId,
        expected,
        (ctx) => {
          const meta = writable(ctx).noteMetadata.find(
            (meta) => meta.noteId === id,
          );
          if (!meta)
            throw new Error("note_missing: This note no longer exists.");
          meta.pinned = pinned;
          meta.revision++;
          return { type: "metadata" };
        },
      );
    },
    setSort: async (order, expectedInput, operationId) => {
      sort(order);
      const expected = token(expectedInput);
      return command(
        "sort",
        [order, expected],
        operationId,
        expected,
        (ctx) => {
          writable(ctx).preferences.sort = order;
          return { type: "metadata" };
        },
      );
    },
    createTag: async (input, expectedInput, operationId) => {
      const checked = object(input, ["name", "color"]),
        name = tagName(checked.name);
      color(checked.color);
      const chosen = checked.color,
        expected = token(expectedInput);
      return command(
        "tag-create",
        [name, chosen, expected],
        operationId,
        expected,
        (ctx) => {
          const state = writable(ctx);
          if (
            state.tags.some(
              (tag) => tag.state === "active" && tag.name === name,
            )
          )
            throw new Error("tag_name_conflict: This tag already exists.");
          return {
            type: "tag",
            tagId: internTag(state, name, new Date().toISOString(), chosen).id,
          };
        },
      );
    },
    renameTag: async (id, inputName, expectedInput, operationId) => {
      uuid(id);
      const name = tagName(inputName),
        expected = token(expectedInput);
      return command(
        "tag-rename",
        [id, name, expected],
        operationId,
        expected,
        (ctx) => {
          renameTag(
            writable(ctx),
            ctx.notes,
            id,
            name,
            new Date().toISOString(),
          );
          return { type: "tag", tagId: id };
        },
      );
    },
    recolorTag: async (id, chosen, expectedInput, operationId) => {
      uuid(id);
      color(chosen);
      const expected = token(expectedInput);
      return command(
        "tag-color",
        [id, chosen, expected],
        operationId,
        expected,
        (ctx) => {
          const tag = activeTag(writable(ctx), id);
          tag.color = chosen;
          tag.revision++;
          tag.updatedAt = new Date().toISOString();
          return { type: "tag", tagId: id };
        },
      );
    },
    mergeTag: async (source, target, expectedInput, operationId) => {
      uuid(source);
      uuid(target);
      const expected = token(expectedInput);
      return command(
        "tag-merge",
        [source, target, expected],
        operationId,
        expected,
        (ctx) => {
          mergeTags(
            writable(ctx),
            ctx.notes,
            source,
            target,
            new Date().toISOString(),
          );
          return { type: "tag", tagId: target };
        },
      );
    },
    deleteTag: async (id, expectedInput, operationId) => {
      uuid(id);
      const expected = token(expectedInput);
      return command(
        "tag-delete",
        [id, expected],
        operationId,
        expected,
        (ctx) => {
          deleteTag(writable(ctx), ctx.notes, id, new Date().toISOString());
          return { type: "tag", tagId: id };
        },
      );
    },
    history: async (id) => {
      noteId(id);
      return access({
        project: (ctx) => {
          findNote(ctx, id);
          return readable(ctx)
            .versions.filter(
              (version) =>
                version.noteId === id &&
                Date.parse(version.capturedAt) >=
                  Date.now() - LIBRARY_LIMITS.historyAgeMs,
            )
            .sort(
              (a, b) =>
                b.capturedAt.localeCompare(a.capturedAt) ||
                b.noteRevision - a.noteRevision,
            );
        },
      });
    },
    version: async (id, versionId) => {
      noteId(id);
      uuid(versionId);
      return access({
        project: (ctx) =>
          readable(ctx).versions.find(
            (version) =>
              version.noteId === id &&
              version.id === versionId &&
              Date.parse(version.capturedAt) >=
                Date.now() - LIBRARY_LIMITS.historyAgeMs,
          ) ?? null,
      });
    },
    restoreVersion: async (id, versionId, revision, operationId) => {
      noteId(id);
      uuid(versionId);
      integer(revision, 1);
      return command(
        "history-restore",
        [id, versionId, revision],
        operationId,
        null,
        (ctx) => {
          const current = checkedNote(ctx, id, revision),
            version = writable(ctx).versions.find(
              (version) =>
                version.noteId === id &&
                version.id === versionId &&
                Date.parse(version.capturedAt) >=
                  Date.now() - LIBRARY_LIMITS.historyAgeMs,
            );
          if (current.trashedAt || !version)
            throw new Error(
              "version_unavailable: This version cannot be restored.",
            );
          const restored = changeNote(
            ctx,
            id,
            revision,
            (note) => ({
              ...note,
              title: version.title,
              document: structuredClone(version.document),
            }),
            "history-restore",
          );
          return {
            type: "note",
            noteId: id,
            resultRevision: restored.revision,
            undo: null,
          };
        },
      );
    },
    changeTrash: async (...args) => changeTrash(...args),
    undoTrash: async (input, operationId) => {
      const checked = undo(input);
      return command("trash-undo", [checked], operationId, null, (ctx) => {
        const state = writable(ctx),
          original = state.receipts.find(
            (receipt) => receipt.id === checked.operationId,
          );
        if (
          checked.epoch !== state.epoch ||
          !original ||
          original.result.type !== "note" ||
          !original.result.undo ||
          JSON.stringify(undo(original.result.undo)) !==
            JSON.stringify(checked) ||
          Date.now() >= Date.parse(checked.expiresAt)
        )
          throw new Error(
            "undo_unavailable: This action can no longer be undone.",
          );
        const note = checkedNote(ctx, checked.noteId, checked.resultRevision);
        if (note.trashedAt !== checked.resultTrashedAt)
          throw new Error(
            "undo_unavailable: The note changed after that action.",
          );
        const restored = changeNote(ctx, note.id, note.revision, (note) => ({
          ...note,
          trashedAt: checked.previousTrashedAt,
        }));
        original.result.undo = null;
        return {
          type: "note",
          noteId: note.id,
          resultRevision: restored.revision,
          undo: null,
        };
      });
    },
    emptyTrash: async (expectedInput, operationId) => {
      const expected = token(expectedInput);
      return command(
        "empty-trash",
        [expected],
        operationId,
        expected,
        (ctx) => {
          const ids = new Set(
            ctx.notes
              .filter((note) => note.trashedAt !== null)
              .map((note) => note.id),
          );
          removeNotes(writable(ctx), ids);
          ctx.notes = ctx.notes.filter((note) => !ids.has(note.id));
          return { type: "empty-trash", removedCount: ids.size };
        },
      );
    },
    eraseLegacy: async (input, operationId) => {
      const checked = object(input, ["deviceGeneration", "confirmation"]);
      integer(checked.deviceGeneration);
      if (checked.confirmation !== "ERASE")
        throw new Error(
          "erase_confirmation_required: Confirm erasing this workspace.",
        );
      uuid(operationId);
      const expectedGeneration = checked.deviceGeneration,
        args = JSON.stringify([expectedGeneration, "ERASE"]);
      let receipt!: LibraryOperationReceipt,
        replayed = false;
      return access({
        legacyErase: true,
        erase: true,
        change: (ctx) => {
          if (ctx.library) {
            const old = ctx.library.receipts.find(
              (receipt) => receipt.id === operationId,
            );
            if (old?.kind === "legacy-erase" && old.arguments === args) {
              receipt = old;
              replayed = true;
              ctx.skipWrite = true;
              return;
            }
            throw new Error(
              "erase_confirmation_stale: Reload the library before confirming erase.",
            );
          }
          if (ctx.generation !== expectedGeneration)
            throw new Error(
              "erase_confirmation_stale: The device data changed. Confirm erase again.",
            );
          const count = ctx.notes.length;
          ctx.notes = [];
          ctx.library = emptyLibrary();
          receipt = {
            id: operationId,
            epoch: ctx.library.epoch,
            committedAt: new Date().toISOString(),
            libraryRevision: 1,
            kind: "legacy-erase",
            arguments: args,
            result: { type: "empty-trash", removedCount: count },
          };
          ctx.library.receipts.push(receipt);
        },
        project: (ctx) => materialize(ctx, receipt, replayed),
      });
    },
  };
  if (searchAdmission) searchOwners.set(library, searchAdmission.access);
  const store: NotesLibraryStore = {
    library,
    list: () => access({ project: (ctx) => ctx.notes }),
    get: (id) =>
      access({
        project: (ctx) => ctx.notes.find((note) => note.id === id) ?? null,
      }),
    create: async (input) => {
      const checked = validateInput(structuredClone(input));
      let id: string;
      return access({
        change: (ctx) => {
          const now = new Date().toISOString();
          id = crypto.randomUUID();
          const note: Note = {
            ...checked,
            id,
            createdAt: now,
            updatedAt: now,
            trashedAt: null,
            revision: 1,
          };
          ctx.notes.push(note);
          syncMembership(writable(ctx), note, now);
        },
        project: (ctx) => findNote(ctx, id),
      });
    },
    update: async (id, patch, revision) => {
      noteId(id);
      integer(revision, 1);
      const stable = structuredClone(patch);
      return access({
        change: (ctx) => {
          changeNote(ctx, id, revision, (current) => ({
            ...current,
            ...validateInput({
              title: stable.title ?? current.title,
              document: stable.document ?? current.document,
              tags: stable.tags ?? current.tags,
            }),
          }));
        },
        project: (ctx) => findNote(ctx, id),
      });
    },
    trash: async (id, revision) =>
      (await changeTrash(id, "trash", revision, crypto.randomUUID())).note!,
    restore: async (id, revision) =>
      (await changeTrash(id, "restore", revision, crypto.randomUUID())).note!,
    erase: () =>
      access({
        erase: true,
        change: (ctx) => {
          const previous = readable(ctx);
          ctx.recoveryCommon = null;
          ctx.notes = [];
          ctx.library = emptyLibrary(previous.revision);
        },
        project: () => undefined,
      }),
    subscribe: (listener) => {
      assertOpen();
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    persistence: () => ({ ...state }),
    close,
  };
  function ownerSnapshot(ctx: Context): LinkOwnerSnapshot {
    return {
      accountId: identity.accountId,
      generation: ctx.generation,
      rawVersion: ctx.rawVersion,
      notes: ctx.notes,
      library: readable(ctx),
      index: ctx.index,
      rawIndex: ctx.rawIndex,
      recordIdentity: ctx.recordIdentity,
      knownMismatch:
        knownMismatch?.epoch === readable(ctx).epoch &&
        knownMismatch?.revision === readable(ctx).revision &&
        knownMismatch?.rawIndex === ctx.rawIndex,
    };
  }
  linkOwners.set(library, {
    read: () => access({ project: ownerSnapshot }),
    authorizeLegacy: async (certificate, fresh) => {
      fresh();
      const current = await access({ project: ownerSnapshot });
      assertOpen();
      fresh();
      if (
        current.rawVersion === 3 ||
        !sameOwnerState(current, certificate.snapshot) ||
        certificate.rows.length
      )
        throw new NoteLinkConflictError(linkToken(current));
      legacyCertificate = structuredClone(certificate);
    },
    mismatch: (snapshot) => {
      assertOpen();
      knownMismatch = {
        epoch: snapshot.library.epoch,
        revision: snapshot.library.revision,
        rawIndex: snapshot.rawIndex,
      };
    },
    repair: async (command, fresh) => {
      let replayed = false,
        committedToken = linkToken(command.certificate.snapshot);
      await access({
        repair: true,
        beforeStage: fresh,
        change: (ctx) => {
          fresh();
          const current = ownerSnapshot(ctx),
            common = readable(ctx);
          if (common.epoch !== command.certificate.snapshot.library.epoch)
            throw new NoteLinkError("note_link_revoked");
          const prior = common.receipts.find(
            (row) => row.id === command.operationId,
          );
          if (prior) {
            if (
              prior.kind !== "note-links-repair" ||
              prior.arguments !== command.arguments ||
              prior.result.type !== "note-links-repair" ||
              prior.result.indexDigest !== command.indexDigest ||
              prior.epoch !== command.certificate.snapshot.library.epoch
            )
              throw new NoteLinkError("note_link_invalid");
            committedToken = {
              epoch: prior.epoch,
              revision: prior.libraryRevision,
            };
            replayed = true;
            ctx.skipWrite = true;
            return;
          }
          if (
            current.rawVersion !== 3 ||
            !sameOwnerState(current, command.certificate.snapshot)
          )
            throw new NoteLinkConflictError(linkToken(current));
          const state = {
            ...common,
            version: 3 as const,
            noteLinks: structuredClone(command.certificate.rows),
          };
          ctx.library = state;
          ctx.recoveryCommon = null;
          validateLinkRows(state.noteLinks, ctx.notes);
          state.receipts.push({
            id: command.operationId,
            epoch: state.epoch,
            committedAt: new Date().toISOString(),
            libraryRevision: state.revision + 1,
            kind: "note-links-repair",
            arguments: command.arguments,
            result: {
              type: "note-links-repair",
              indexDigest: command.indexDigest,
            },
          });
          ctx.protectedReceipt = command.operationId;
          committedToken = { epoch: state.epoch, revision: state.revision + 1 };
        },
        project: () => undefined,
      });
      if (
        knownMismatch?.epoch === command.certificate.snapshot.library.epoch &&
        knownMismatch.revision ===
          command.certificate.snapshot.library.revision &&
        knownMismatch.rawIndex === command.certificate.snapshot.rawIndex
      )
        knownMismatch = null;
      legacyCertificate = null;
      return { committedToken, replayed };
    },
  });
  function sourceSnapshot(ctx: Context): SourceOwnerSnapshot {
    if (!ctx.library || !ctx.collections)
      throw new SourceError(
        "source_revoked",
        "Open the real Notes and Study owners before continuing.",
      );
    return {
      notes: ctx.notes,
      library: ctx.library,
      collections: ctx.collections,
    };
  }
  sourceOwners.set(library, {
    read: () => access({ collections: true, project: sourceSnapshot }),
    commit: async (command, fresh) => {
      let replayed = false;
      const snapshot = await access({
        collections: true,
        beforeStage: fresh,
        change: (ctx) => {
          fresh();
          const current = sourceSnapshot(ctx);
          if (
            current.library.epoch !== command.expected.library.epoch ||
            current.collections.epoch !== command.expected.collections.epoch
          )
            throw new SourceError(
              "source_revoked",
              "The workspace was erased.",
            );
          const receipt = current.library.sourceReceipts.find(
            (receipt) => receipt.operationId === command.operationId,
          );
          if (receipt) {
            if (receipt.digest !== command.digest)
              throw new SourceError(
                "source_operation_reused",
                "This source operation has different saved content.",
              );
            ctx.skipWrite = true;
            replayed = true;
            return;
          }
          const tokens = sourceTokens(current);
          if (
            tokens.library.revision !== command.expected.library.revision ||
            tokens.collections.revision !==
              command.expected.collections.revision
          )
            throw new SourceConflictError(tokens);
          if (current.collections.revision >= Number.MAX_SAFE_INTEGER)
            throw new SourceError(
              "source_limit",
              "Collections revisions are exhausted.",
            );
          applySourceCommand(current, command);
          current.collections.revision++;
        },
        project: sourceSnapshot,
      });
      return { snapshot, replayed };
    },
  });
  return store;
}
