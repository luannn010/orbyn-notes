import { validateLinkRows } from "../links/scanner";
import type { Note } from "../domain/contracts";
import { inspectNoteDocument } from "../domain/validation";
import type {
  LibraryState,
  LibraryCommonState,
  LegacyLibraryState,
  LibraryToken,
  NoteSort,
  TagColor,
  TrashUndo,
} from "./contracts";
import { LibraryCapacityError } from "./contracts";
import {
  SOURCE_LIMITS,
  validateSourceAnchor,
  validateSourceReceipt,
} from "../study/sourceValidation";
export const LEGACY_LIBRARY_BYTES = 64 * 1024 * 1024;
export const SOURCE_LIBRARY_OVERHEAD = new TextEncoder().encode(
  ',"anchors":[],"sourceReceipts":[]',
).byteLength;
export const LINK_LIBRARY_OVERHEAD = new TextEncoder().encode(
  ',"noteLinks":[]',
).byteLength;
export const SOURCE_LIBRARY_BYTES =
  LEGACY_LIBRARY_BYTES + SOURCE_LIBRARY_OVERHEAD;
export const LIBRARY_LIMITS = {
  tags: 10000,
  notes: 10000,
  bytes: SOURCE_LIBRARY_BYTES + LINK_LIBRARY_OVERHEAD,
  historyBytes: 32 * 1024 * 1024,
  noteHistoryBytes: 8 * 1024 * 1024,
  noteVersions: 50,
  historyAgeMs: 30 * 86400000,
  receipts: 500,
  receiptAgeMs: 600000,
  undoMs: 5000,
} as const;
export function invalid(): never {
  throw new Error(
    "library_invalid: Library metadata is unsupported or corrupt. The saved copy was kept.",
  );
}
export function object(
  value: unknown,
  keys: string[],
): Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  )
    invalid();
  const row = value as Record<string, unknown>;
  if (
    Object.keys(row).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(row, key))
  )
    invalid();
  return row;
}
export function uuid(value: unknown): asserts value is string {
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  )
    invalid();
}
export function integer(value: unknown, min = 0): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min)
    invalid();
}
export function text(value: unknown, max: number): asserts value is string {
  if (typeof value !== "string" || value.length > max) invalid();
}
export function noteId(value: unknown): asserts value is string {
  if (typeof value !== "string") invalid();
}
export function timestamp(
  value: unknown,
  canonical = true,
): asserts value is string {
  if (
    typeof value !== "string" ||
    !Number.isFinite(Date.parse(value)) ||
    (canonical && new Date(value).toISOString() !== value)
  )
    invalid();
}
export function color(value: unknown): asserts value is TagColor {
  if (
    value !== null &&
    (typeof value !== "string" || !/^#[0-9a-f]{6}$/i.test(value))
  )
    invalid();
}
export function sort(value: unknown): asserts value is NoteSort {
  if (value !== "edited" && value !== "created" && value !== "title") invalid();
}
export function token(value: unknown): LibraryToken {
  const row = object(value, ["epoch", "revision"]);
  uuid(row.epoch);
  integer(row.revision);
  return { epoch: row.epoch, revision: row.revision };
}
export function tagName(value: unknown): string {
  text(value, 100);
  const name = value.trim();
  if (!name) throw new Error("tag_name_invalid: Enter a tag name.");
  return name;
}
export function jsonBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}
function array(value: unknown, max: number): asserts value is unknown[] {
  if (!Array.isArray(value)) invalid();
  if (value.length > max) throw new LibraryCapacityError();
}
export function undo(value: unknown): TrashUndo {
  const row = object(value, [
    "epoch",
    "operationId",
    "noteId",
    "resultRevision",
    "previousTrashedAt",
    "resultTrashedAt",
    "expiresAt",
  ]);
  uuid(row.epoch);
  uuid(row.operationId);
  noteId(row.noteId);
  integer(row.resultRevision, 1);
  timestamp(row.expiresAt);
  if (row.previousTrashedAt !== null) timestamp(row.previousTrashedAt, false);
  if (row.resultTrashedAt !== null) timestamp(row.resultTrashedAt, false);
  const checked = structuredClone(value as TrashUndo);
  return {
    epoch: checked.epoch,
    operationId: checked.operationId,
    noteId: checked.noteId,
    resultRevision: checked.resultRevision,
    previousTrashedAt: checked.previousTrashedAt,
    resultTrashedAt: checked.resultTrashedAt,
    expiresAt: checked.expiresAt,
  };
}
function validateLibraryState(
  value: unknown,
  notes: Note[],
  legacy: boolean,
  recoverIndex = false,
): unknown {
  const linked =
    !legacy && (value as { version?: unknown } | null)?.version === 3;
  const state = object(value, [
    "version",
    "epoch",
    "revision",
    "tags",
    "noteMetadata",
    "versions",
    "preferences",
    "receipts",
    "legacyDuplicateTags",
    ...(legacy ? [] : ["anchors", "sourceReceipts"]),
    ...(linked ? ["noteLinks"] : []),
  ]);
  if (state.version !== (legacy ? 1 : linked ? 3 : 2)) invalid();
  uuid(state.epoch);
  integer(state.revision);
  array(state.tags, LIBRARY_LIMITS.tags);
  array(state.noteMetadata, LIBRARY_LIMITS.notes);
  array(state.versions, LIBRARY_LIMITS.notes * LIBRARY_LIMITS.noteVersions);
  array(state.receipts, LIBRARY_LIMITS.receipts);
  array(state.legacyDuplicateTags, LIBRARY_LIMITS.notes);
  const prefs = object(state.preferences, ["sort"]);
  sort(prefs.sort);
  const tags = new Map<string, Record<string, unknown>>(),
    names = new Set<string>();
  for (const item of state.tags) {
    const row = object(item, [
      "id",
      "name",
      "color",
      "revision",
      "createdAt",
      "updatedAt",
      "state",
      "mergedInto",
    ]);
    uuid(row.id);
    if (tags.has(row.id)) invalid();
    text(row.name, 100);
    color(row.color);
    integer(row.revision, 1);
    timestamp(row.createdAt);
    timestamp(row.updatedAt);
    if (Date.parse(row.updatedAt) < Date.parse(row.createdAt)) invalid();
    if (!["active", "deleted", "merged"].includes(row.state as string))
      invalid();
    if (row.state === "merged") uuid(row.mergedInto);
    else if (row.mergedInto !== null) invalid();
    if (row.state === "active") {
      if (names.has(row.name)) invalid();
      names.add(row.name);
    }
    tags.set(row.id, row);
  }
  for (const tag of tags.values())
    if (
      tag.state === "merged" &&
      (tag.id === tag.mergedInto ||
        tags.get(tag.mergedInto as string)?.state !== "active")
    )
      invalid();
  const current = new Map(notes.map((note) => [note.id, note])),
    seen = new Set<string>();
  for (const item of state.noteMetadata) {
    const row = object(item, ["noteId", "revision", "pinned", "tagIds"]);
    noteId(row.noteId);
    integer(row.revision, 1);
    if (
      typeof row.pinned !== "boolean" ||
      seen.has(row.noteId) ||
      !current.has(row.noteId)
    )
      invalid();
    seen.add(row.noteId);
    array(row.tagIds, 100);
    const ids = new Set<string>();
    const labels: string[] = [];
    for (const id of row.tagIds) {
      uuid(id);
      if (ids.has(id) || tags.get(id)?.state !== "active") invalid();
      ids.add(id);
      labels.push(tags.get(id)!.name as string);
    }
    if (
      JSON.stringify(labels) !== JSON.stringify(current.get(row.noteId)!.tags)
    )
      invalid();
  }
  if (seen.size !== current.size) invalid();
  const versionIds = new Set<string>(),
    revisions = new Set<string>(),
    perNote = new Map<string, { count: number; bytes: number }>();
  for (const item of state.versions) {
    const row = object(item, [
      "id",
      "noteId",
      "noteRevision",
      "capturedAt",
      "reason",
      "title",
      "document",
      "tagsAtCapture",
    ]);
    uuid(row.id);
    noteId(row.noteId);
    integer(row.noteRevision, 1);
    timestamp(row.capturedAt);
    text(row.title, 500);
    if (
      versionIds.has(row.id) ||
      !current.has(row.noteId) ||
      row.noteRevision > current.get(row.noteId)!.revision ||
      (row.reason !== "edit" && row.reason !== "history-restore")
    )
      invalid();
    versionIds.add(row.id);
    const revision = JSON.stringify([row.noteId, row.noteRevision]);
    if (revisions.has(revision)) invalid();
    revisions.add(revision);
    inspectNoteDocument(row.document, linked ? "notes" : "plain");
    array(row.tagsAtCapture, 100);
    const historical = new Set<string>();
    for (const item of row.tagsAtCapture) {
      const tag = object(item, ["id", "name", "color"]);
      uuid(tag.id);
      text(tag.name, 100);
      color(tag.color);
      if (!tags.has(tag.id) || historical.has(tag.id)) invalid();
      historical.add(tag.id);
    }
    const size = perNote.get(row.noteId) ?? { count: 0, bytes: 0 };
    size.count++;
    size.bytes += jsonBytes(row);
    perNote.set(row.noteId, size);
    if (
      size.count > LIBRARY_LIMITS.noteVersions ||
      size.bytes > LIBRARY_LIMITS.noteHistoryBytes
    )
      throw new LibraryCapacityError();
  }
  if (jsonBytes(state.versions) > LIBRARY_LIMITS.historyBytes)
    throw new LibraryCapacityError();
  const receiptIds = new Set<string>();
  for (const item of state.receipts) {
    const row = object(item, [
      "id",
      "epoch",
      "committedAt",
      "libraryRevision",
      "kind",
      "arguments",
      "result",
    ]);
    uuid(row.id);
    uuid(row.epoch);
    integer(row.libraryRevision, 1);
    timestamp(row.committedAt);
    text(row.arguments, 2048);
    if (
      row.epoch !== state.epoch ||
      row.libraryRevision > state.revision ||
      receiptIds.has(row.id) ||
      ![
        "pin",
        "sort",
        "tag-create",
        "tag-rename",
        "tag-color",
        "tag-merge",
        "tag-delete",
        "history-restore",
        "trash",
        "restore",
        "trash-undo",
        "empty-trash",
        "legacy-erase",
        ...(linked ? ["note-links-repair"] : []),
      ].includes(row.kind as string)
    )
      invalid();
    receiptIds.add(row.id);
    try {
      JSON.parse(row.arguments);
    } catch {
      invalid();
    }
    const result = row.result as Record<string, unknown> | null;
    if (!result) invalid();
    if (row.kind === "note-links-repair") {
      object(result, ["type", "indexDigest"]);
      if (
        result.type !== "note-links-repair" ||
        typeof result.indexDigest !== "string" ||
        !/^[a-f0-9]{64}$/.test(result.indexDigest)
      )
        invalid();
      const args = object(JSON.parse(row.arguments as string), [
        "revision",
        "rawIndexDigest",
        "documentsDigest",
        "indexDigest",
      ]);
      integer(args.revision);
      if ((args.revision as number) + 1 !== row.libraryRevision) invalid();
      for (const key of ["rawIndexDigest", "documentsDigest", "indexDigest"])
        if (
          typeof args[key] !== "string" ||
          !/^[a-f0-9]{64}$/.test(args[key] as string)
        )
          invalid();
      if (args.indexDigest !== result.indexDigest) invalid();
    } else if (result.type === "metadata") object(result, ["type"]);
    else if (result.type === "tag") {
      object(result, ["type", "tagId"]);
      uuid(result.tagId);
      if (!tags.has(result.tagId)) invalid();
    } else if (result.type === "empty-trash") {
      object(result, ["type", "removedCount"]);
      integer(result.removedCount);
      if (result.removedCount > LIBRARY_LIMITS.notes) invalid();
    } else if (result.type === "note") {
      object(result, ["type", "noteId", "resultRevision", "undo"]);
      noteId(result.noteId);
      integer(result.resultRevision, 1);
      if (result.undo !== null) {
        const checked = undo(result.undo);
        if (
          checked.epoch !== state.epoch ||
          checked.noteId !== result.noteId ||
          checked.resultRevision !== result.resultRevision ||
          checked.operationId !== row.id
        )
          invalid();
      }
    } else invalid();
  }
  const legacyIds = new Set<string>();
  for (const item of state.legacyDuplicateTags) {
    const row = object(item, ["noteId", "values"]);
    noteId(row.noteId);
    array(row.values, 100);
    if (!current.has(row.noteId) || legacyIds.has(row.noteId)) invalid();
    legacyIds.add(row.noteId);
    for (const value of row.values) text(value, 100);
  }
  if (!legacy) {
    array(state.anchors, SOURCE_LIMITS.anchors);
    array(state.sourceReceipts, SOURCE_LIMITS.receipts);
    const anchors = new Set<string>(),
      entries = new Set<string>(),
      receipts = new Set<string>();
    for (const raw of state.anchors) {
      const anchor = validateSourceAnchor(raw);
      const note = current.get(anchor.noteId);
      if (
        anchors.has(anchor.id) ||
        entries.has(anchor.entryId) ||
        !note ||
        anchor.noteRevision > note.revision ||
        (anchor.status === "attached" && anchor.noteRevision !== note.revision)
      )
        invalid();
      anchors.add(anchor.id);
      entries.add(anchor.entryId);
    }
    for (const raw of state.sourceReceipts) {
      const receipt = validateSourceReceipt(raw);
      if (receipts.has(receipt.operationId)) invalid();
      receipts.add(receipt.operationId);
    }
  }
  if (linked && !recoverIndex) validateLinkRows(state.noteLinks, notes);
  if (
    jsonBytes(value) >
    (legacy
      ? LEGACY_LIBRARY_BYTES
      : linked
        ? LIBRARY_LIMITS.bytes
        : SOURCE_LIBRARY_BYTES)
  )
    throw new LibraryCapacityError();
  return structuredClone(value);
}
export function validateLegacyLibrary(
  value: unknown,
  notes: Note[],
): LegacyLibraryState {
  return validateLibraryState(value, notes, true) as LegacyLibraryState;
}
export function validateLibrary(value: unknown, notes: Note[]): LibraryState {
  return validateLibraryState(value, notes, false) as LibraryState;
}
export function validateLibraryCommon(
  value: unknown,
  notes: Note[],
): LibraryCommonState {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  const raw = value as Record<string, unknown>;
  // Every common field is validated above; the untrusted isolated index is
  // deliberately omitted rather than cast to a typed LibraryState.
  const checked = validateLibraryState(
    Object.hasOwn(raw, "noteLinks") ? raw : { ...raw, noteLinks: undefined },
    notes,
    false,
    true,
  ) as LibraryCommonState & { noteLinks: unknown };
  const { noteLinks: _untrustedIndex, ...common } = checked;
  return common;
}
export function normalizeLibrary(value: unknown, notes: Note[]): LibraryState {
  if ((value as { version?: unknown } | null)?.version === 1)
    return validateLibrary(
      {
        ...validateLegacyLibrary(value, notes),
        version: 2,
        anchors: [],
        sourceReceipts: [],
      },
      notes,
    );
  return validateLibrary(value, notes);
}
