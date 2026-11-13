import { safeHref } from "../domain/validation";
import { ClipError } from "./contracts";
import type { ClipActionInput, ClipState } from "./contracts";

export const CLIP_LIMITS = {
  items: 5000,
  receipts: 500,
  url: 8192,
  title: 300,
  text: 100000,
  bytes: 12 * 1024 * 1024,
} as const;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function invalid(): never {
  throw new ClipError("clip_invalid", "Unsupported or corrupt clip data.");
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
function text(value: unknown, max: number): asserts value is string {
  if (typeof value !== "string" || value.length > max) invalid();
}
function bool(value: unknown): asserts value is boolean {
  if (typeof value !== "boolean") invalid();
}
function date(value: unknown): asserts value is string {
  if (
    typeof value !== "string" ||
    value.length !== 24 ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  )
    invalid();
}
export function clipUrl(value: unknown): {
  originalUrl: string;
  canonicalUrl: string;
  hostname: string;
} {
  text(value, CLIP_LIMITS.url);
  if (!safeHref(value)) invalid();
  const authority = /^https?:\/\/([^/?#]*)/i.exec(value)?.[1];
  if (!authority || authority.includes("@") || value.includes("\\")) invalid();
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    invalid();
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    !url.hostname ||
    url.username ||
    url.password
  )
    invalid();
  url.hash = "";
  if (url.toString().length > CLIP_LIMITS.url) invalid();
  return {
    originalUrl: value,
    canonicalUrl: url.toString(),
    hostname: url.hostname,
  };
}
export function validateClipAction(value: unknown): ClipActionInput {
  if (!value || typeof value !== "object") invalid();
  const kind = (value as { kind?: unknown }).kind;
  if (kind === "create") {
    const row = object(value, [
      "kind",
      "url",
      "title",
      "text",
      "readLater",
      "allowDuplicate",
    ]);
    const url = clipUrl(row.url);
    text(row.title, CLIP_LIMITS.title);
    text(row.text, CLIP_LIMITS.text);
    bool(row.readLater);
    bool(row.allowDuplicate);
    const title = row.title.trim() || url.hostname;
    text(title, CLIP_LIMITS.title);
    return {
      kind,
      url: url.originalUrl,
      title,
      text: row.text.trim() ? row.text : "",
      readLater: row.readLater,
      allowDuplicate: row.allowDuplicate,
    };
  }
  if (kind === "undo-create") {
    const row = object(value, ["kind", "receiptOperationId", "targetRevision"]);
    id(row.receiptOperationId);
    integer(row.targetRevision, 1);
    return {
      kind,
      receiptOperationId: row.receiptOperationId,
      targetRevision: row.targetRevision,
    };
  }
  if (
    kind === "set-read" ||
    kind === "set-read-later" ||
    kind === "set-archived"
  ) {
    const flag =
      kind === "set-read"
        ? "read"
        : kind === "set-read-later"
          ? "readLater"
          : "archived";
    const row = object(value, ["kind", "clipId", "targetRevision", flag]);
    id(row.clipId);
    integer(row.targetRevision, 1);
    bool(row[flag]);
    return structuredClone(row) as ClipActionInput;
  }
  invalid();
}
export function validateClipState(value: unknown): ClipState {
  const state = object(value, ["items", "receipts"]);
  if (!Array.isArray(state.items) || !Array.isArray(state.receipts)) invalid();
  if (
    state.items.length > CLIP_LIMITS.items ||
    state.receipts.length > CLIP_LIMITS.receipts
  )
    throw new ClipError("clip_limit", "Clips exceed the local storage limits.");
  const items = new Set<string>(),
    receipts = new Set<string>();
  for (const value of state.items) {
    const row = object(value, [
      "id",
      "revision",
      "originalUrl",
      "canonicalUrl",
      "title",
      "text",
      "createdAt",
      "updatedAt",
      "readAt",
      "readLater",
      "archivedAt",
    ]);
    id(row.id);
    integer(row.revision, 1);
    if (items.has(row.id)) invalid();
    items.add(row.id);
    const url = clipUrl(row.originalUrl);
    if (url.canonicalUrl !== row.canonicalUrl) invalid();
    text(row.title, CLIP_LIMITS.title);
    if (!row.title || row.title.trim() !== row.title) invalid();
    if (row.text !== null) {
      text(row.text, CLIP_LIMITS.text);
      if (!row.text.trim()) invalid();
    }
    date(row.createdAt);
    date(row.updatedAt);
    if (row.updatedAt < row.createdAt) invalid();
    for (const key of ["readAt", "archivedAt"])
      if (row[key] !== null) {
        date(row[key]);
        if (row[key] < row.createdAt || row[key] > row.updatedAt) invalid();
      }
    bool(row.readLater);
  }
  for (const value of state.receipts) {
    const row = object(value, [
      "operationId",
      "digest",
      "kind",
      "clipId",
      "resultRevision",
      "at",
      "changed",
    ]);
    id(row.operationId);
    id(row.clipId);
    date(row.at);
    bool(row.changed);
    if (receipts.has(row.operationId)) invalid();
    receipts.add(row.operationId);
    if (typeof row.digest !== "string" || !/^[a-f0-9]{64}$/.test(row.digest))
      invalid();
    if (
      ![
        "create",
        "set-read",
        "set-read-later",
        "set-archived",
        "undo-create",
      ].includes(row.kind as string)
    )
      invalid();
    if (row.kind === "undo-create") {
      if (row.resultRevision !== null || !row.changed) invalid();
    } else {
      integer(row.resultRevision, 1);
      if (row.kind === "create" && (row.resultRevision !== 1 || !row.changed))
        invalid();
    }
  }
  if (
    new TextEncoder().encode(JSON.stringify(value)).byteLength >
    CLIP_LIMITS.bytes
  )
    throw new ClipError("clip_limit", "Clips exceed the local storage limits.");
  return structuredClone(value as ClipState);
}
export function emptyClips(): ClipState {
  return { items: [], receipts: [] };
}
