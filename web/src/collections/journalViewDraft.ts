import type { JournalContext, JournalFreshness } from "./journal";

export type HabitFormInput = {
  mode: "create" | "edit";
  id: string | null;
  name: string;
};
export type HabitFormDraft = HabitFormInput & {
  version: 1;
  originalName: string;
  dirty: boolean;
};
export type HabitDraftEnvelope = { version: 1; iv: string; ciphertext: string };
export type LinkSelectionJSON =
  | { type: "all" }
  | { type: "node"; anchor: number }
  | { type: "text"; anchor: number; head: number };
export type LinkFormInput = {
  date: string;
  source: "toolbar" | "slash";
  from: number;
  to: number;
  selection: LinkSelectionJSON;
  initialUrl: string;
  url: string;
};
export type LinkFormDraft = LinkFormInput & {
  version: 1;
  entryId: string | null;
  entryRevision: number;
  dirty: boolean;
};
export type ProtectedFormDrafts = {
  version: 1;
  habit: HabitFormDraft | null;
  link: LinkFormDraft | null;
};
export type ProtectedFormsEnvelope = HabitDraftEnvelope;
const MAX_FORMS_BYTES = 4 * 1024 * 1024;
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function invalid(): never {
  throw new Error(
    "journal_form_invalid: The protected form draft could not be read.",
  );
}
function object(value: unknown, fields: string[]): Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  )
    invalid();
  const row = value as Record<string, unknown>;
  if (
    Object.keys(row).length !== fields.length ||
    fields.some((field) => !Object.hasOwn(row, field))
  )
    invalid();
  return row;
}
export function validateHabitFormInput(value: unknown): HabitFormInput {
  const row = object(value, ["mode", "id", "name"]);
  if (row.mode !== "create" && row.mode !== "edit") invalid();
  if (
    row.mode === "create"
      ? row.id !== null
      : typeof row.id !== "string" || !uuid.test(row.id)
  )
    invalid();
  if (typeof row.name !== "string" || row.name.length > 200) invalid();
  return structuredClone(value as HabitFormInput);
}
export function validateHabitFormDraft(value: unknown): HabitFormDraft {
  const row = object(value, [
    "version",
    "mode",
    "id",
    "name",
    "originalName",
    "dirty",
  ]);
  validateHabitFormInput({ mode: row.mode, id: row.id, name: row.name });
  if (
    row.version !== 1 ||
    typeof row.originalName !== "string" ||
    row.originalName.length > 200 ||
    typeof row.dirty !== "boolean" ||
    row.dirty !== (row.name !== row.originalName) ||
    (row.mode === "create" && row.originalName !== "")
  )
    invalid();
  return structuredClone(value as HabitFormDraft);
}
function bytes(
  value: unknown,
  min: number,
  max: number,
): Uint8Array<ArrayBuffer> {
  if (
    typeof value !== "string" ||
    value.length > Math.ceil(max / 3) * 4 ||
    value.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(value)
  )
    invalid();
  const decoded = atob(value);
  if (decoded.length < min || decoded.length > max || btoa(decoded) !== value)
    invalid();
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
}
function base64(value: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < value.length; offset += 8192)
    binary += String.fromCharCode(...value.subarray(offset, offset + 8192));
  return btoa(binary);
}
function aad(
  context: JournalContext,
  purpose = "orbyn/journal/habit-draft/v1",
): Uint8Array<ArrayBuffer> {
  if (!uuid.test(context.accountId) || !uuid.test(context.epoch)) invalid();
  return new TextEncoder().encode(
    JSON.stringify([purpose, context.accountId, context.epoch]),
  );
}
function position(value: unknown): asserts value is number {
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < 0 ||
    (value as number) > 4_000_000
  )
    invalid();
}
export function validateLinkFormInput(value: unknown): LinkFormInput {
  const item = object(value, [
    "date",
    "source",
    "from",
    "to",
    "selection",
    "initialUrl",
    "url",
  ]);
  if (
    typeof item.date !== "string" ||
    !/^[1-9]\d{3}-\d{2}-\d{2}$/.test(item.date) ||
    !Number.isFinite(Date.parse(`${item.date}T12:00:00Z`)) ||
    new Date(`${item.date}T12:00:00Z`).toISOString().slice(0, 10) !== item.date
  )
    invalid();
  if (item.source !== "toolbar" && item.source !== "slash") invalid();
  position(item.from);
  position(item.to);
  if (item.to < item.from) invalid();
  const selection = item.selection as Record<string, unknown> | null;
  if (!selection) invalid();
  if (selection.type === "all") object(selection, ["type"]);
  else if (selection.type === "node") {
    object(selection, ["type", "anchor"]);
    position(selection.anchor);
  } else if (selection.type === "text") {
    object(selection, ["type", "anchor", "head"]);
    position(selection.anchor);
    position(selection.head);
  } else invalid();
  if (
    typeof item.initialUrl !== "string" ||
    typeof item.url !== "string" ||
    item.initialUrl.length > 2_000_000 ||
    item.url.length > 2_000_000
  )
    invalid();
  // Invalid/unfinished URLs are recoverable input, not committed link attributes.
  if (new TextEncoder().encode(JSON.stringify(value)).length > MAX_FORMS_BYTES)
    invalid();
  return structuredClone(value as LinkFormInput);
}
export function validateLinkFormDraft(value: unknown): LinkFormDraft {
  const item = object(value, [
    "date",
    "source",
    "from",
    "to",
    "selection",
    "initialUrl",
    "url",
    "version",
    "entryId",
    "entryRevision",
    "dirty",
  ]);
  validateLinkFormInput({
    date: item.date,
    source: item.source,
    from: item.from,
    to: item.to,
    selection: item.selection,
    initialUrl: item.initialUrl,
    url: item.url,
  });
  if (
    item.version !== 1 ||
    (item.entryId !== null &&
      (typeof item.entryId !== "string" || !uuid.test(item.entryId))) ||
    !Number.isSafeInteger(item.entryRevision) ||
    (item.entryRevision as number) < 0 ||
    (item.entryId === null && item.entryRevision !== 0) ||
    (item.entryId !== null && item.entryRevision === 0) ||
    typeof item.dirty !== "boolean" ||
    item.dirty !== (item.url !== item.initialUrl)
  )
    invalid();
  return structuredClone(value as LinkFormDraft);
}
export function validateProtectedForms(value: unknown): ProtectedFormDrafts {
  const item = object(value, ["version", "habit", "link"]);
  if (item.version !== 1) invalid();
  if (item.habit !== null) validateHabitFormDraft(item.habit);
  if (item.link !== null) validateLinkFormDraft(item.link);
  if (new TextEncoder().encode(JSON.stringify(value)).length > MAX_FORMS_BYTES)
    invalid();
  return structuredClone(value as ProtectedFormDrafts);
}

export async function sealProtectedForms(
  key: CryptoKey,
  forms: ProtectedFormDrafts,
  context: JournalContext,
  current: JournalFreshness,
): Promise<ProtectedFormsEnvelope> {
  current();
  checkKey(key);
  const data = validateProtectedForms(forms),
    binding = aad(context, "orbyn/journal/protected-forms/v1");
  const plain = new TextEncoder().encode(JSON.stringify(data)),
    iv = crypto.getRandomValues(new Uint8Array(12));
  try {
    const encrypted = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: binding, tagLength: 128 },
      key,
      plain,
    );
    current();
    return {
      version: 1,
      iv: base64(iv),
      ciphertext: base64(new Uint8Array(encrypted)),
    };
  } finally {
    plain.fill(0);
  }
}
export async function openProtectedForms(
  key: CryptoKey,
  envelope: ProtectedFormsEnvelope,
  context: JournalContext,
  current: JournalFreshness,
): Promise<ProtectedFormDrafts> {
  current();
  checkKey(key);
  const item = object(envelope, ["version", "iv", "ciphertext"]);
  if (item.version !== 1) invalid();
  const iv = bytes(item.iv, 12, 12),
    ciphertext = bytes(item.ciphertext, 16, MAX_FORMS_BYTES + 16),
    binding = aad(context, "orbyn/journal/protected-forms/v1");
  let plain: ArrayBuffer;
  try {
    plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv, additionalData: binding, tagLength: 128 },
      key,
      ciphertext,
    );
  } catch {
    current();
    throw new Error(
      "journal_form_unlock_failed: The protected form drafts could not be unlocked.",
    );
  }
  try {
    current();
    if (plain.byteLength > MAX_FORMS_BYTES) invalid();
    const result = validateProtectedForms(
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(plain)),
    );
    current();
    return result;
  } finally {
    new Uint8Array(plain).fill(0);
  }
}
function checkKey(key: CryptoKey) {
  if (
    key.extractable ||
    key.type !== "secret" ||
    key.algorithm.name !== "AES-GCM" ||
    (key.algorithm as AesKeyAlgorithm).length !== 256
  )
    invalid();
}
export async function sealHabitDraft(
  key: CryptoKey,
  draft: HabitFormDraft,
  context: JournalContext,
  current: JournalFreshness,
): Promise<HabitDraftEnvelope> {
  current();
  checkKey(key);
  const data = validateHabitFormDraft(draft),
    binding = aad(context);
  const plain = new TextEncoder().encode(JSON.stringify(data));
  if (plain.byteLength > 8192) invalid();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  try {
    const encrypted = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: binding, tagLength: 128 },
      key,
      plain,
    );
    current();
    return {
      version: 1,
      iv: base64(iv),
      ciphertext: base64(new Uint8Array(encrypted)),
    };
  } finally {
    plain.fill(0);
  }
}
export async function openHabitDraft(
  key: CryptoKey,
  envelope: HabitDraftEnvelope,
  context: JournalContext,
  current: JournalFreshness,
): Promise<HabitFormDraft> {
  current();
  checkKey(key);
  const row = object(envelope, ["version", "iv", "ciphertext"]);
  if (row.version !== 1) invalid();
  const iv = bytes(row.iv, 12, 12),
    ciphertext = bytes(row.ciphertext, 16, 16384),
    binding = aad(context);
  let plain: ArrayBuffer;
  try {
    plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv, additionalData: binding, tagLength: 128 },
      key,
      ciphertext,
    );
  } catch {
    current();
    throw new Error(
      "journal_form_unlock_failed: The protected habit draft could not be unlocked.",
    );
  }
  try {
    current();
    if (plain.byteLength > 8192) invalid();
    const data = validateHabitFormDraft(
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(plain)),
    );
    current();
    return data;
  } finally {
    new Uint8Array(plain).fill(0);
  }
}
