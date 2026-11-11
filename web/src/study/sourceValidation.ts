import { SourceError } from "./sourceContracts";
import type {
  AnchoredStudySource,
  MakeCardDraft,
  SavedNoteSelection,
  SourceAnchor,
  SourceExpected,
  SourceReceipt,
} from "./sourceContracts";
export const SOURCE_LIMITS = {
  anchors: 10000,
  receipts: 500,
  text: 100000,
} as const;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function invalid(): never {
  throw new SourceError(
    "source_invalid",
    "Unsupported or corrupt source data.",
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
export function id(value: unknown): asserts value is string {
  if (typeof value !== "string" || !UUID.test(value)) invalid();
}
export function integer(value: unknown, min = 0): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min)
    invalid();
}
export function text(
  value: unknown,
  nonempty = false,
  max: number = SOURCE_LIMITS.text,
): asserts value is string {
  if (
    typeof value !== "string" ||
    value.length > max ||
    (nonempty && !value.trim())
  )
    invalid();
}
export function digest(value: unknown): asserts value is string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) invalid();
}
function date(value: unknown) {
  if (
    typeof value !== "string" ||
    value.length !== 24 ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  )
    invalid();
}
function range(row: Record<string, unknown>) {
  integer(row.from, 1);
  integer(row.to, 1);
  if (row.from >= row.to || row.to > 2_000_000) invalid();
}
export function validateAnchoredSource(value: unknown): AnchoredStudySource {
  const row = object(value, [
    "version",
    "noteId",
    "noteRevision",
    "quote",
    "libraryEpoch",
    "anchorId",
  ]);
  if (row.version !== 2) invalid();
  text(row.noteId, false, 2_000_000);
  integer(row.noteRevision, 1);
  text(row.quote, true);
  id(row.libraryEpoch);
  id(row.anchorId);
  return structuredClone(value as AnchoredStudySource);
}
export function validateSourceAnchor(value: unknown): SourceAnchor {
  const row = object(value, [
    "id",
    "revision",
    "noteId",
    "entryId",
    "birth",
    "noteRevision",
    "from",
    "to",
    "quote",
    "documentDigest",
    "status",
    "staleReason",
  ]);
  id(row.id);
  id(row.entryId);
  text(row.noteId, false, 2_000_000);
  integer(row.revision, 1);
  integer(row.noteRevision, 1);
  range(row);
  text(row.quote, true);
  digest(row.documentDigest);
  const birth = object(row.birth, [
    "noteRevision",
    "documentDigest",
    "from",
    "to",
  ]);
  integer(birth.noteRevision, 1);
  digest(birth.documentDigest);
  range(birth);
  if (
    birth.noteRevision > row.noteRevision ||
    (row.status === "attached"
      ? row.staleReason !== null
      : row.status !== "stale" ||
        !["passage-edited", "document-replaced"].includes(
          row.staleReason as string,
        ))
  )
    invalid();
  return structuredClone(value as SourceAnchor);
}
export function validateSourceReceipt(value: unknown): SourceReceipt {
  const row = object(value, [
    "operationId",
    "digest",
    "kind",
    "at",
    "entryId",
    "cardIds",
    "anchorId",
    "createOperationId",
    "entryRevision",
    "cardRevisions",
    "anchorRevision",
  ]);
  for (const key of ["operationId", "entryId", "anchorId", "createOperationId"])
    id(row[key]);
  digest(row.digest);
  date(row.at);
  if (
    !["create", "undo"].includes(row.kind as string) ||
    row.entryRevision !== 1 ||
    row.anchorRevision !== 1 ||
    !Array.isArray(row.cardIds) ||
    !Array.isArray(row.cardRevisions) ||
    !row.cardIds.length ||
    row.cardIds.length > 100 ||
    row.cardIds.length !== row.cardRevisions.length ||
    new Set(row.cardIds).size !== row.cardIds.length
  )
    invalid();
  for (const value of row.cardIds) id(value);
  for (const value of row.cardRevisions) if (value !== 1) invalid();
  if (row.kind === "create" && row.operationId !== row.createOperationId)
    invalid();
  return structuredClone(value as SourceReceipt);
}
export function validateSourceExpected(value: unknown): SourceExpected {
  const row = object(value, ["library", "collections"]);
  for (const key of ["library", "collections"]) {
    const token = object(row[key], ["epoch", "revision"]);
    id(token.epoch);
    integer(token.revision);
  }
  return structuredClone(value as SourceExpected);
}
export function validateMakeCardDraft(value: unknown): MakeCardDraft {
  if (!value || typeof value !== "object") invalid();
  const kind = (value as { type?: unknown }).type;
  const row = object(value, [
    "deckId",
    "tags",
    "type",
    ...(kind === "cloze" ? ["text", "blanks"] : ["front", "back"]),
  ]);
  id(row.deckId);
  if (
    !Array.isArray(row.tags) ||
    row.tags.length > 100 ||
    new Set(row.tags).size !== row.tags.length
  )
    invalid();
  for (const tag of row.tags) text(tag, true, 100);
  if (kind === "basic" || kind === "reversed") {
    text(row.front, true);
    text(row.back, true);
  } else if (kind === "cloze") {
    text(row.text, true);
    if (
      !Array.isArray(row.blanks) ||
      !row.blanks.length ||
      row.blanks.length > 100
    )
      invalid();
    const ids = new Set<string>();
    for (const blank of row.blanks) {
      const b = object(blank, ["id", "answer"]);
      if (
        typeof b.id !== "string" ||
        !/^[A-Za-z0-9_-]{1,100}$/.test(b.id) ||
        ids.has(b.id)
      )
        invalid();
      ids.add(b.id);
      text(b.answer, true);
    }
    const matches = [...row.text.matchAll(/\{\{([^{}]+)\}\}/g)].map(
      (match) => match[1]!,
    );
    if (
      matches.length !== ids.size ||
      new Set(matches).size !== matches.length ||
      matches.some((key) => !ids.has(key)) ||
      row.text.replace(/\{\{[^{}]+\}\}/g, "").includes("{{") ||
      row.text.replace(/\{\{[^{}]+\}\}/g, "").includes("}}")
    )
      invalid();
  } else invalid();
  return structuredClone(value as MakeCardDraft);
}
export function validateSavedSelection(value: unknown): SavedNoteSelection {
  const row = object(value, [
    "noteId",
    "noteRevision",
    "libraryEpoch",
    "fingerprint",
    "passage",
  ]);
  text(row.noteId, false, 2_000_000);
  integer(row.noteRevision, 1);
  id(row.libraryEpoch);
  const passage = object(row.passage, ["from", "to", "quote"]);
  range(passage);
  text(passage.quote, true);
  const fingerprint = object(row.fingerprint, [
    "document",
    "canonicalJSON",
    "digest",
  ]);
  text(fingerprint.canonicalJSON, true, 2_000_000);
  digest(fingerprint.digest);
  return structuredClone(value as SavedNoteSelection);
}
