import type { NoteDocument } from "../domain/contracts";
import { validateDocument } from "../domain/validation";
import type { JournalEnvelope } from "./contracts";
import { validateJournalEnvelope } from "./validation";

export type JournalEntry = { id: string; date: string; document: NoteDocument; prompt: string | null; createdAt: string; updatedAt: string; revision: number };
export type Habit = { id: string; name: string; order: number; createdAt: string; createdOn: string; archivedAt: string | null; archivedOn: string | null; revision: number };
export type JournalData = { version: 1; entries: JournalEntry[]; habits: Habit[]; completions: { date: string; habitId: string; done: boolean; updatedAt: string }[]; preferences: { promptEnabled: boolean; lockAfterSeconds: 60 } };
export type JournalContext = { accountId: string; epoch: string };
export type JournalFreshness = () => void;
const MAX_BYTES = 10_000_000;
const encoder = new TextEncoder();
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function invalid(): never { throw new Error("journal_invalid: Journal data could not be read. The saved copy was kept."); }
function row(value: unknown, fields: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) invalid();
  const result = value as Record<string, unknown>;
  if (Object.keys(result).length !== fields.length || fields.some(key => !Object.hasOwn(result, key))) invalid();
  return result;
}
function date(value: unknown): asserts value is string {
  if (typeof value !== "string" || !/^[1-9]\d{3}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(`${value}T12:00:00Z`)) || new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) !== value)
    throw new Error("invalid_date: Choose a valid calendar date.");
}
function timestamp(value: unknown) {
  if (typeof value !== "string" || value.length !== 24 || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) invalid();
}
function id(value: unknown): asserts value is string { if (typeof value !== "string" || !uuid.test(value)) invalid(); }
function revision(value: unknown) { if (!Number.isSafeInteger(value) || (value as number) < 1) invalid(); }
export function emptyJournal(): JournalData {
  return { version: 1, entries: [], habits: [], completions: [], preferences: { promptEnabled: true, lockAfterSeconds: 60 } };
}
export function validateJournalData(value: unknown): JournalData {
  let serialized: string;
  try { serialized = JSON.stringify(value); } catch { invalid(); }
  if (!serialized! || encoder.encode(serialized!).length > MAX_BYTES) invalid();
  const data = row(value, ["version", "entries", "habits", "completions", "preferences"]);
  if (data.version !== 1 || !Array.isArray(data.entries) || data.entries.length > 10_000 || !Array.isArray(data.habits) || data.habits.length > 100 || !Array.isArray(data.completions) || data.completions.length > 100_000) invalid();
  const prefs = row(data.preferences, ["promptEnabled", "lockAfterSeconds"]);
  if (typeof prefs.promptEnabled !== "boolean" || prefs.lockAfterSeconds !== 60) invalid();
  const ids = new Set<string>(), dates = new Set<string>();
  for (const item of data.entries) {
    const entry = row(item, ["id", "date", "document", "prompt", "createdAt", "updatedAt", "revision"]);
    id(entry.id); date(entry.date); timestamp(entry.createdAt); timestamp(entry.updatedAt); revision(entry.revision);
    if (ids.has(entry.id) || dates.has(entry.date) || (entry.prompt !== null && (typeof entry.prompt !== "string" || entry.prompt.length > 1000))) invalid();
    ids.add(entry.id); dates.add(entry.date);
    validateDocument(entry.document);
  }
  const habits = new Set<string>();
  for (const item of data.habits) {
    const habit = row(item, ["id", "name", "order", "createdAt", "createdOn", "archivedAt", "archivedOn", "revision"]);
    id(habit.id); timestamp(habit.createdAt); date(habit.createdOn); revision(habit.revision);
    if (habit.archivedAt !== null) { timestamp(habit.archivedAt); date(habit.archivedOn); if (habit.archivedOn < habit.createdOn) invalid(); }
    else if (habit.archivedOn !== null) invalid();
    if (habits.has(habit.id) || typeof habit.name !== "string" || !habit.name.trim() || habit.name.length > 200 || !Number.isInteger(habit.order) || (habit.order as number) < 0 || (habit.order as number) > 100) invalid();
    habits.add(habit.id);
  }
  const completions = new Set<string>();
  for (const item of data.completions) {
    const completion = row(item, ["date", "habitId", "done", "updatedAt"]);
    date(completion.date); id(completion.habitId); timestamp(completion.updatedAt);
    const key = `${completion.date}:${completion.habitId}`;
    if (!habits.has(completion.habitId) || completions.has(key) || typeof completion.done !== "boolean") invalid();
    completions.add(key);
  }
  return structuredClone(value as JournalData);
}
export function writeJournalEntry(data: JournalData, day: string, document: NoteDocument, prompt: string | null, at: Date): JournalData {
  date(day);
  const next = structuredClone(data), existing = next.entries.find(entry => entry.date === day);
  const entry: JournalEntry = { id: existing?.id ?? crypto.randomUUID(), date: day, document: validateDocument(document), prompt, createdAt: existing?.createdAt ?? at.toISOString(), updatedAt: at.toISOString(), revision: (existing?.revision ?? 0) + 1 };
  next.entries = next.entries.filter(item => item.date !== day);
  next.entries.push(entry);
  return validateJournalData(next);
}
export function setHabitCompletion(data: JournalData, day: string, habitId: string, done: boolean, at: Date): JournalData {
  date(day);
  if (!data.habits.some(habit => habit.id === habitId && habit.createdOn <= day && (!habit.archivedOn || habit.archivedOn >= day))) throw new Error("habit_missing: This habit is unavailable for this date.");
  const next = structuredClone(data);
  next.completions = next.completions.filter(item => item.date !== day || item.habitId !== habitId);
  next.completions.push({ date: day, habitId, done, updatedAt: at.toISOString() });
  return validateJournalData(next);
}

export function journalToday(at = new Date()): string {
  if (!Number.isFinite(+at)) throw new Error("invalid_date: Choose a valid calendar date.");
  return `${at.getFullYear().toString().padStart(4, "0")}-${(at.getMonth() + 1).toString().padStart(2, "0")}-${at.getDate().toString().padStart(2, "0")}`;
}
export function saveHabit(data: JournalData, name: string, at: Date, habitId?: string): JournalData {
  if (!name.trim() || name.length > 200) throw new Error("invalid_habit: Enter a habit name up to 200 characters.");
  const next = structuredClone(data), habit = next.habits.find(item => item.id === habitId);
  if (habitId && !habit) throw new Error("habit_missing: This habit no longer exists.");
  if (habit) { habit.name = name.trim(); habit.revision++; }
  else {
    if (next.habits.length >= 100) throw new Error("habit_limit: You can keep up to 100 habits, including archived habits.");
    next.habits.push({ id: crypto.randomUUID(), name: name.trim(), order: next.habits.length, createdAt: at.toISOString(), createdOn: journalToday(at), archivedAt: null, archivedOn: null, revision: 1 });
  }
  return validateJournalData(next);
}
export function archiveHabit(data: JournalData, habitId: string, at: Date): JournalData {
  const next = structuredClone(data), habit = next.habits.find(item => item.id === habitId);
  if (!habit) throw new Error("habit_missing: This habit no longer exists.");
  if (!habit.archivedAt) { habit.archivedAt = at.toISOString(); habit.archivedOn = journalToday(at); habit.revision++; }
  return validateJournalData(next);
}
export function journalMonth(data: JournalData, year: number, month: number) {
  if (!Number.isInteger(year) || year < 1000 || year > 9999 || !Number.isInteger(month) || month < 1 || month > 12) throw new Error("invalid_month: Choose a valid month.");
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const entries = new Map(data.entries.map(entry => [entry.date, entry]));
  const completions = new Map<string, Set<string>>();
  for (const completion of data.completions) if (completion.done) {
    const ids = completions.get(completion.date) ?? new Set<string>(); ids.add(completion.habitId); completions.set(completion.date, ids);
  }
  const hasText = (nodes: NoteDocument["content"]): boolean => nodes.some(node => !!node.text?.trim() || !!node.content && hasText(node.content));
  return Array.from({ length: days }, (_, i) => {
    const day = `${year}-${String(month).padStart(2, "0")}-${String(i + 1).padStart(2, "0")}`;
    const entry = entries.get(day) ?? null, done = completions.get(day) ?? new Set<string>();
    const relevant = data.habits.filter(habit => done.has(habit.id) || habit.createdOn <= day && (!habit.archivedOn || habit.archivedOn >= day));
    return { date: day, entry: entry ? structuredClone(entry) : null, written: !!entry && hasText(entry.document.content), habitsCompleted: done.size, habitTotal: relevant.length };
  });
}

function base64(bytes: Uint8Array): string {
  // Chunked to avoid argument-list limits for real-sized journals.
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}
function bytes(value: string): Uint8Array<ArrayBuffer> { return Uint8Array.from(atob(value), char => char.charCodeAt(0)); }
function aad(context: JournalContext): Uint8Array<ArrayBuffer> {
  id(context.accountId); id(context.epoch);
  return encoder.encode(JSON.stringify(["orbyn/journal/v1", context.accountId, context.epoch]));
}
function checkPassphrase(passphrase: string) {
  if (typeof passphrase !== "string" || passphrase.length < 12 || passphrase.length > 1024) throw new Error("invalid_passphrase: Use a Journal passphrase of 12 to 1,024 characters.");
}
async function derive(passphrase: string, salt: Uint8Array<ArrayBuffer>, current: JournalFreshness): Promise<CryptoKey> {
  checkPassphrase(passphrase); current();
  const encoded = encoder.encode(passphrase);
  try {
    const material = await crypto.subtle.importKey("raw", encoded, "PBKDF2", false, ["deriveKey"]);
    current();
    const key = await crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: 600_000, hash: "SHA-256" }, material, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    current(); return key;
  } finally { encoded.fill(0); }
}
export async function sealJournalData(key: CryptoKey, kdf: JournalEnvelope["kdf"], data: JournalData, context: JournalContext, current: JournalFreshness): Promise<JournalEnvelope> {
  current();
  if (key.extractable || key.type !== "secret" || key.algorithm.name !== "AES-GCM" || (key.algorithm as AesKeyAlgorithm).length !== 256) throw new Error("invalid_journal_key: Unlock Journal again.");
  const checked = validateJournalData(data), iv = crypto.getRandomValues(new Uint8Array(12));
  // Validate and snapshot the header before encrypt yields to a caller. The tag-sized
  // placeholder is never persisted; the authenticated ciphertext replaces it below.
  const header = validateJournalEnvelope({ version: 1, kdf, iv: base64(iv), ciphertext: base64(new Uint8Array(16)) })!;
  const plain = encoder.encode(JSON.stringify(checked));
  try {
    const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: aad(context), tagLength: 128 }, key, plain);
    current();
    return validateJournalEnvelope({ ...header, ciphertext: base64(new Uint8Array(encrypted)) })!;
  } finally { plain.fill(0); }
}
export async function createJournalEnvelope(passphrase: string, data: JournalData, context: JournalContext, current: JournalFreshness): Promise<{ envelope: JournalEnvelope; key: CryptoKey }> {
  current(); aad(context);
  const stable = validateJournalData(data), binding = structuredClone(context);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await derive(passphrase, salt, current);
  const envelope = await sealJournalData(key, { name: "PBKDF2-SHA256", iterations: 600000, salt: base64(salt) }, stable, binding, current);
  current(); return { envelope, key };
}
export async function unlockJournalEnvelope(envelope: JournalEnvelope, passphrase: string, context: JournalContext, current: JournalFreshness): Promise<{ data: JournalData; key: CryptoKey }> {
  current();
  const binding = structuredClone(context);
  aad(binding);
  const checked = validateJournalEnvelope(envelope);
  if (!checked) throw new Error("journal_missing: Set up Journal first.");
  const key = await derive(passphrase, bytes(checked.kdf.salt), current);
  let plain: ArrayBuffer;
  try { plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes(checked.iv), additionalData: aad(binding), tagLength: 128 }, key, bytes(checked.ciphertext)); }
  catch { current(); throw new Error("journal_unlock_failed: Couldn’t unlock Journal. Check your passphrase and try again."); }
  try {
    current();
    if (plain.byteLength > MAX_BYTES) invalid();
    const data = validateJournalData(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(plain)));
    current(); return { data, key };
  } finally { new Uint8Array(plain).fill(0); }
}
