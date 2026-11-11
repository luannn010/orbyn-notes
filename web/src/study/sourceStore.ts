import type { CollectionsStore } from "../collections/contracts";
import {
  assertCollectionsAccess,
  onCollectionsEpochChange,
} from "../collections/store";
import { lockVersion, onLock } from "../account/session";
import { studySourceOwner } from "../library/store";
import type { NotesLibraryStore } from "../library/contracts";
import {
  canonicalSourceDocument,
  captureSourceSelection,
  fingerprintSourceDocument,
  SOURCE_CODEC_LIMITS,
} from "./sourceCodec";
import { resolveSource, sourceTokens } from "./sourceModel";
import { SourceError } from "./sourceContracts";
import type {
  MakeCardIntent,
  UndoMakeCardIntent,
  SourceCommand,
  SourceOwnerSnapshot,
  StudySourceService,
  MakeCardResult,
} from "./sourceContracts";
import {
  id,
  validateMakeCardDraft,
  validateSavedSelection,
  validateSourceExpected,
} from "./sourceValidation";

export function createStudySourceService(
  notes: NotesLibraryStore,
  collections: CollectionsStore,
): StudySourceService {
  assertCollectionsAccess(collections);
  const owner = studySourceOwner(notes),
    openedLock = lockVersion();
  let closed = false,
    generation = 0,
    observedEpoch: string | undefined;
  let held = new WeakMap<
    MakeCardIntent | UndoMakeCardIntent,
    { command: SourceCommand; generation: number }
  >();
  const listeners = new Set<() => void>(),
    invalidations = new Set<(reason: "epoch" | "closed") => void>();
  const stopLock = onLock(close);
  let stopEpoch: () => void, stopNotes: () => void, stopCollections: () => void;
  try {
    stopEpoch = onCollectionsEpochChange(collections, () =>
      invalidate("epoch"),
    );
    stopNotes = notes.subscribe(refresh);
    stopCollections = collections.subscribe(refresh);
  } catch (error) {
    stopLock();
    stopEpoch!?.();
    stopNotes!?.();
    throw error;
  }
  function invalidate(reason: "epoch" | "closed") {
    generation++;
    held = new WeakMap();
    for (const listener of invalidations) {
      try {
        listener(reason);
      } catch {
        /* Complete all revocations. */
      }
    }
  }
  function close() {
    if (closed) return;
    closed = true;
    invalidate("closed");
    stopLock();
    stopEpoch?.();
    stopNotes?.();
    stopCollections?.();
    listeners.clear();
    invalidations.clear();
  }
  function guard(captured = generation) {
    if (closed || lockVersion() !== openedLock || captured !== generation)
      throw new SourceError(
        "source_revoked",
        "This source operation is no longer authorized.",
      );
    assertCollectionsAccess(collections);
  }
  function observe(state: SourceOwnerSnapshot) {
    const epoch = `${state.library.epoch}:${state.collections.epoch}`;
    if (observedEpoch !== undefined && epoch !== observedEpoch)
      invalidate("epoch");
    observedEpoch = epoch;
  }
  async function read(captured = generation) {
    guard(captured);
    const state = await owner.read();
    guard(captured);
    observe(state);
    guard(captured);
    return state;
  }
  function refresh() {
    if (closed) return;
    void read()
      .then(() => {
        for (const listener of listeners) {
          try {
            listener();
          } catch {
            /* Observer isolation. */
          }
        }
      })
      .catch(() => {});
  }
  async function hash(value: unknown, captured: number) {
    const bytes = new TextEncoder().encode(JSON.stringify(value));
    try {
      const result = await crypto.subtle.digest("SHA-256", bytes);
      guard(captured);
      return Array.from(new Uint8Array(result), (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join("");
    } finally {
      bytes.fill(0);
    }
  }
  async function resolve(entryId: string) {
    id(entryId);
    const captured = generation,
      first = await read(captured);
    const entry = first.collections.study.entries.find(
      (entry) => entry.id === entryId,
    );
    const note = first.notes.find((note) => note.id === entry?.source?.noteId);
    if (!note) return resolveSource(first, entryId, "");
    const fingerprint = await fingerprintSourceDocument(note.document);
    guard(captured);
    const latest = await read(captured),
      currentNote = latest.notes.find((row) => row.id === note.id);
    if (
      !currentNote ||
      currentNote.revision !== note.revision ||
      canonicalSourceDocument(currentNote.document).canonicalJSON !==
        fingerprint.canonicalJSON
    )
      return { status: "unavailable" as const, reason: "stale" as const };
    return resolveSource(latest, entryId, fingerprint.digest);
  }
  return {
    async prepareCreate(selectionInput, expectedInput, draftInput) {
      guard();
      const captured = generation,
        selection = validateSavedSelection(selectionInput),
        expected = validateSourceExpected(expectedInput),
        draft = validateMakeCardDraft(draftInput);
      const operationId = crypto.randomUUID(),
        entryId = crypto.randomUUID(),
        anchorId = crypto.randomUUID(),
        preparedAt = new Date().toISOString();
      const cardIds = Array.from(
        {
          length:
            draft.type === "reversed"
              ? 2
              : draft.type === "cloze"
                ? draft.blanks.length
                : 1,
        },
        () => crypto.randomUUID(),
      );
      const fingerprint = await fingerprintSourceDocument(
        selection.fingerprint.document,
      );
      guard(captured);
      if (
        fingerprint.digest !== selection.fingerprint.digest ||
        fingerprint.canonicalJSON !== selection.fingerprint.canonicalJSON
      )
        throw new SourceError(
          "source_invalid",
          "The captured selection fingerprint is invalid.",
        );
      if (
        captureSourceSelection(
          fingerprint.document,
          selection.passage.from,
          selection.passage.to,
        ).passage.quote !== selection.passage.quote
      )
        throw new SourceError(
          "source_invalid",
          "The selected quote does not match its captured range.",
        );
      const state = await read(captured);
      if (
        state.library.epoch !== expected.library.epoch ||
        state.collections.epoch !== expected.collections.epoch
      )
        throw new SourceError("source_revoked", "The workspace was erased.");
      const body = {
        kind: "create" as const,
        operationId,
        expected,
        preparedAt,
        entryId,
        anchorId,
        cardIds,
        selection,
        draft,
      };
      const digest = await hash(body, captured);
      await read(captured);
      const intent = Object.freeze({
        kind: "create",
        operationId,
        entryId,
      }) as MakeCardIntent;
      held.set(intent, { command: { ...body, digest }, generation: captured });
      return intent;
    },
    async prepareUndo(expectedInput, receiptOperationId) {
      guard();
      const captured = generation,
        expected = validateSourceExpected(expectedInput);
      id(receiptOperationId);
      const operationId = crypto.randomUUID(),
        preparedAt = new Date().toISOString(),
        state = await read(captured);
      if (
        state.library.epoch !== expected.library.epoch ||
        state.collections.epoch !== expected.collections.epoch
      )
        throw new SourceError("source_revoked", "The workspace was erased.");
      const original = state.library.sourceReceipts.find(
        (receipt) =>
          receipt.operationId === receiptOperationId &&
          receipt.kind === "create",
      );
      if (!original)
        throw new SourceError(
          "source_undo_unavailable",
          "The original card receipt is no longer available.",
        );
      const body = {
        kind: "undo" as const,
        operationId,
        expected,
        preparedAt,
        entryId: original.entryId,
        original: structuredClone(original),
      };
      const digest = await hash(body, captured);
      await read(captured);
      const intent = Object.freeze({
        kind: "undo",
        operationId,
        entryId: original.entryId,
      }) as UndoMakeCardIntent;
      held.set(intent, { command: { ...body, digest }, generation: captured });
      return intent;
    },
    async commit(intent): Promise<MakeCardResult> {
      guard();
      const prepared = intent && held.get(intent);
      if (!prepared)
        throw new SourceError(
          "source_revoked",
          "Prepare a new authorized source action.",
        );
      const fresh = () => guard(prepared.generation);
      fresh();
      const result = await owner.commit(prepared.command, fresh);
      fresh();
      observe(result.snapshot);
      fresh();
      const receipt = result.snapshot.library.sourceReceipts.find(
        (row) => row.operationId === prepared.command.operationId,
      );
      if (!receipt || receipt.digest !== prepared.command.digest)
        throw new SourceError(
          "source_operation_reused",
          "The source operation result does not match.",
        );
      const anchor = result.snapshot.library.anchors.find(
        (anchor) => anchor.id === receipt.anchorId,
      );
      return {
        entryId: receipt.entryId,
        cardIds: receipt.cardIds.slice(),
        receipt: structuredClone(receipt),
        changed: true,
        replayed: result.replayed,
        tokens: sourceTokens(result.snapshot),
        source: resolveSource(
          result.snapshot,
          receipt.entryId,
          anchor?.documentDigest ?? "",
        ),
      };
    },
    resolve,
    async annotations(noteId) {
      const captured = generation,
        state = await read(captured),
        entries = state.collections.study.entries.filter(
          (entry) => entry.source?.noteId === noteId,
        );
      const note = state.notes.find((note) => note.id === noteId);
      if (!note || note.trashedAt !== null || !entries.length) return [];
      const fingerprint = await fingerprintSourceDocument(note.document);
      guard(captured);
      const latest = await read(captured),
        current = latest.notes.find((row) => row.id === note.id);
      if (
        !current ||
        current.revision !== note.revision ||
        canonicalSourceDocument(current.document).canonicalJSON !==
          fingerprint.canonicalJSON
      )
        return [];
      const latestEntries = latest.collections.study.entries.filter(
          (entry) => entry.source?.noteId === noteId,
        ),
        anchorsById = new Map(
          latest.library.anchors.map((anchor) => [anchor.id, anchor]),
        );
      const work = latestEntries.reduce((sum, entry) => {
        const source = entry.source;
        const anchor =
          source && "version" in source
            ? anchorsById.get(source.anchorId)
            : undefined;
        return (
          sum +
          (anchor?.status === "attached"
            ? fingerprint.canonicalJSON.length +
              (anchor.to - anchor.from) * 2 +
              64
            : 64)
        );
      }, 0);
      if (work > SOURCE_CODEC_LIMITS.replayUnits)
        throw new SourceError(
          "source_limit",
          "This annotation projection exceeds its supported work limit.",
        );
      const results = [];
      for (const entry of latestEntries) {
        const source = entry.source,
          anchor =
            source && "version" in source
              ? anchorsById.get(source.anchorId)
              : undefined;
        // Bounded single-entity views avoid quadratic repeated ID scans.
        const projection = {
          ...latest,
          notes: [current],
          library: { ...latest.library, anchors: anchor ? [anchor] : [] },
          collections: {
            ...latest.collections,
            study: { ...latest.collections.study, entries: [entry] },
          },
        };
        const result = resolveSource(projection, entry.id, fingerprint.digest);
        if (result.status === "attached") results.push(result);
      }
      return results;
    },
    subscribe(listener) {
      guard();
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    onInvalidate(listener) {
      guard();
      invalidations.add(listener);
      return () => invalidations.delete(listener);
    },
    persistence: () => notes.persistence(),
    close,
  };
}
