import { NoteLinkError, type NoteTarget } from "./contracts";

export const NOTE_REFERENCE_LIMITS = Object.freeze({
  uri: 8192,
  payload64: 8000,
  jsonBytes: 6000,
  noteId64: 5462,
  noteIdBytes: 4096,
});
const PREFIX = "orbyn-notes://note/v1/";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const encoder = new TextEncoder();
function invalid(): never {
  throw new NoteLinkError("note_link_invalid");
}
function large(): never {
  throw new NoteLinkError("note_link_reference_too_large");
}
export function isWellFormedReferenceId(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const unit = value.charCodeAt(i);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(++i);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) return false;
  }
  return true;
}
export function validateNoteTarget(input: unknown): NoteTarget {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    (Object.getPrototypeOf(input) !== Object.prototype &&
      Object.getPrototypeOf(input) !== null)
  )
    invalid();
  const row = input as Record<string, unknown>;
  if (
    Object.keys(row).length !== 4 ||
    !["kind", "accountId", "libraryEpoch", "noteId"].every((key) =>
      Object.hasOwn(row, key),
    ) ||
    row.kind !== "note" ||
    typeof row.accountId !== "string" ||
    !UUID.test(row.accountId) ||
    typeof row.libraryEpoch !== "string" ||
    !UUID.test(row.libraryEpoch) ||
    typeof row.noteId !== "string"
  )
    invalid();
  // Storage admits opaque UTF16 IDs unchanged. Transport encoding checks their
  // well-formedness and its narrower byte cap separately.
  return Object.freeze({
    kind: "note",
    accountId: row.accountId,
    libraryEpoch: row.libraryEpoch,
    noteId: row.noteId,
  });
}
function encode64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
function decode64(
  value: string,
  maxChars: number,
  maxBytes: number,
): Uint8Array {
  if (value.length > maxChars) large();
  if (!/^[A-Za-z0-9_-]*$/.test(value) || value.length % 4 === 1) invalid();
  let binary: string;
  try {
    binary = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
  } catch {
    invalid();
  }
  if (binary.length > maxBytes) large();
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  if (encode64(bytes) !== value) invalid();
  return bytes;
}
function canonical(target: NoteTarget, noteId64: string): string {
  return JSON.stringify({
    v: 1,
    kind: "note",
    accountId: target.accountId,
    libraryEpoch: target.libraryEpoch,
    noteId64,
  });
}
export function encodeNoteReference(input: NoteTarget): string {
  const target = validateNoteTarget(input);
  if (target.noteId.length > NOTE_REFERENCE_LIMITS.noteIdBytes) large();
  if (!isWellFormedReferenceId(target.noteId))
    throw new NoteLinkError("note_link_reference_unencodable");
  const id = encoder.encode(target.noteId);
  if (id.length > NOTE_REFERENCE_LIMITS.noteIdBytes) large();
  const bytes = encoder.encode(canonical(target, encode64(id)));
  if (bytes.length > NOTE_REFERENCE_LIMITS.jsonBytes) large();
  const payload = encode64(bytes);
  const uri = PREFIX + payload;
  if (
    payload.length > NOTE_REFERENCE_LIMITS.payload64 ||
    uri.length > NOTE_REFERENCE_LIMITS.uri
  )
    large();
  return uri;
}
export function decodeNoteReference(input: unknown): NoteTarget {
  if (typeof input !== "string") invalid();
  if (input.length > NOTE_REFERENCE_LIMITS.uri) large();
  if (!input.startsWith(PREFIX)) invalid();
  const bytes = decode64(
    input.slice(PREFIX.length),
    NOTE_REFERENCE_LIMITS.payload64,
    NOTE_REFERENCE_LIMITS.jsonBytes,
  );
  let text: string, value: unknown;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
      bytes,
    );
    value = JSON.parse(text);
  } catch {
    invalid();
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  const row = value as Record<string, unknown>;
  if (
    Object.keys(row).length !== 5 ||
    row.v !== 1 ||
    row.kind !== "note" ||
    typeof row.noteId64 !== "string"
  )
    invalid();
  const id = decode64(
    row.noteId64,
    NOTE_REFERENCE_LIMITS.noteId64,
    NOTE_REFERENCE_LIMITS.noteIdBytes,
  );
  let noteId: string;
  try {
    noteId = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
      id,
    );
  } catch {
    invalid();
  }
  const target = validateNoteTarget({
    kind: "note",
    accountId: row.accountId,
    libraryEpoch: row.libraryEpoch,
    noteId,
  });
  if (canonical(target, row.noteId64) !== text) invalid();
  return target;
}
