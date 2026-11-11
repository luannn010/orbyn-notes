import type {
  CollectionsState,
  LegacyCollectionsState,
  CollectionsStateV2,
  JournalEnvelope,
  Schedule,
  StudyEntry,
  StudyState,
} from "./contracts";
import { emptyClips, validateClipState } from "../clips/validation";
import { validateAnchoredSource } from "../study/sourceValidation";

export const LEGACY_COLLECTIONS_BYTES = 32 * 1024 * 1024;
export const EMPTY_CLIPS_OVERHEAD = new TextEncoder().encode(
  ',"clips":{"items":[],"receipts":[]}',
).byteLength;

export const COLLECTIONS_LIMITS = {
  decks: 1000,
  entries: 10000,
  cards: 20000,
  events: 100000,
  text: 100000,
  serializedBytes: LEGACY_COLLECTIONS_BYTES + EMPTY_CLIPS_OVERHEAD,
  envelopeBytes: 12 * 1024 * 1024,
} as const;
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const blankId = /^[A-Za-z0-9_-]{1,100}$/;
function fail(): never {
  throw new Error(
    "collections_invalid: Unsupported or corrupt collections data.",
  );
}
function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  )
    fail();
  const result = value as Record<string, unknown>;
  if (
    Object.keys(result).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(result, key))
  )
    fail();
  return result;
}
function text(
  value: unknown,
  max: number = COLLECTIONS_LIMITS.text,
  nonempty = false,
): asserts value is string {
  if (
    typeof value !== "string" ||
    value.length > max ||
    (nonempty && !value.trim())
  )
    fail();
}
function id(value: unknown): asserts value is string {
  if (typeof value !== "string" || !uuid.test(value)) fail();
}
function integer(
  value: unknown,
  min = 0,
  max = Number.MAX_SAFE_INTEGER,
): asserts value is number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < min ||
    value > max
  )
    fail();
}
function date(value: unknown): asserts value is string {
  if (
    typeof value !== "string" ||
    value.length !== 24 ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  )
    fail();
}
function array(value: unknown, max: number): asserts value is unknown[] {
  if (!Array.isArray(value) || value.length > max) fail();
}
function bool(value: unknown) {
  if (typeof value !== "boolean") fail();
}
function unique(
  rows: unknown[],
  check: (value: unknown) => Record<string, unknown>,
): Map<string, Record<string, unknown>> {
  const seen = new Map<string, Record<string, unknown>>();
  for (const value of rows) {
    const row = check(value);
    id(row.id);
    if (seen.has(row.id)) fail();
    seen.set(row.id, row);
  }
  return seen;
}
function schedule(value: unknown): asserts value is Schedule {
  const row = object(value, [
    "version",
    "state",
    "due",
    "intervalDays",
    "ease",
    "repetitions",
    "lapses",
    "lastReviewedAt",
  ]);
  if (
    row.version !== 1 ||
    !["new", "learning", "review"].includes(row.state as string)
  )
    fail();
  date(row.due);
  integer(row.intervalDays, 0, 36500);
  integer(row.repetitions);
  integer(row.lapses);
  if (
    typeof row.ease !== "number" ||
    !Number.isFinite(row.ease) ||
    row.ease < 1.3 ||
    row.ease > 3
  )
    fail();
  if (row.lastReviewedAt !== null) date(row.lastReviewedAt);
}
export function derivedCardKeys(entry: StudyEntry): string[] {
  return entry.type === "basic"
    ? ["basic:forward"]
    : entry.type === "reversed"
      ? ["reversed:forward", "reversed:reverse"]
      : entry.blanks.map((blank) => `cloze:${blank.id}`);
}
export function emptyStudy(timezone = "UTC"): StudyState {
  return {
    decks: [],
    entries: [],
    cards: [],
    events: [],
    preferences: {
      algorithm: "orbyn-interval-v1",
      timezone,
      dayStartHour: 4,
      newPerDay: 10,
      reviewsPerDay: 100,
      showNextReview: true,
      showStreak: true,
    },
  };
}
export function validateJournalEnvelope(
  value: unknown,
): JournalEnvelope | null {
  if (value === null) return null;
  const row = object(value, ["version", "kdf", "iv", "ciphertext"]);
  const kdf = object(row.kdf, ["name", "iterations", "salt"]);
  if (
    row.version !== 1 ||
    kdf.name !== "PBKDF2-SHA256" ||
    kdf.iterations !== 600000
  )
    fail();
  const binary = (value: unknown, min: number, max: number) => {
    if (
      typeof value !== "string" ||
      value.length > Math.ceil(max / 3) * 4 ||
      value.length % 4 !== 0 ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(value)
    )
      fail();
    const decoded = atob(value);
    if (decoded.length < min || decoded.length > max || btoa(decoded) !== value)
      fail();
  };
  binary(kdf.salt, 16, 16);
  binary(row.iv, 12, 12);
  binary(row.ciphertext, 16, COLLECTIONS_LIMITS.envelopeBytes);
  return structuredClone(value as JournalEnvelope);
}
function validateState(
  value: unknown,
  version: 1 | 2 | 3,
): CollectionsState | LegacyCollectionsState | CollectionsStateV2 {
  const legacy = version === 1;
  const row = object(value, [
    "version",
    "epoch",
    "revision",
    "study",
    "journal",
    ...(legacy ? [] : ["clips"]),
  ]);
  if (row.version !== version) fail();
  id(row.epoch);
  integer(row.revision);
  const study = object(row.study, [
    "decks",
    "entries",
    "cards",
    "events",
    "preferences",
  ]);
  array(study.decks, COLLECTIONS_LIMITS.decks);
  array(study.entries, COLLECTIONS_LIMITS.entries);
  array(study.cards, COLLECTIONS_LIMITS.cards);
  array(study.events, COLLECTIONS_LIMITS.events);
  const decks = unique(study.decks, (value) => {
    const d = object(value, [
      "id",
      "title",
      "createdAt",
      "updatedAt",
      "revision",
    ]);
    text(d.title, 1000, true);
    date(d.createdAt);
    date(d.updatedAt);
    if (d.updatedAt < d.createdAt) fail();
    integer(d.revision, 1);
    return d;
  });
  const entries = unique(study.entries, (value) => {
    const candidate = value as Record<string, unknown> | null;
    const variant = candidate?.type;
    const extra = variant === "cloze" ? ["text", "blanks"] : ["front", "back"];
    const e = object(value, [
      "id",
      "deckId",
      "tags",
      "source",
      "revision",
      "type",
      ...extra,
    ]);
    id(e.deckId);
    if (!decks.has(e.deckId)) fail();
    integer(e.revision, 1);
    array(e.tags, 100);
    const tags = new Set<string>();
    for (const tag of e.tags) {
      text(tag, 100, true);
      if (tags.has(tag)) fail();
      tags.add(tag);
    }
    if (e.source !== null) {
      if (version === 3 && (e.source as { version?: unknown })?.version === 2)
        validateAnchoredSource(e.source);
      else {
        const s = object(e.source, ["noteId", "noteRevision", "quote"]);
        id(s.noteId);
        integer(s.noteRevision, 1);
        text(s.quote);
      }
    }
    if (variant === "basic" || variant === "reversed") {
      text(e.front, COLLECTIONS_LIMITS.text, true);
      text(e.back, COLLECTIONS_LIMITS.text, true);
    } else if (variant === "cloze") {
      text(e.text, COLLECTIONS_LIMITS.text, true);
      array(e.blanks, 100);
      if (!e.blanks.length) fail();
      const blanks = new Set<string>();
      for (const raw of e.blanks) {
        const b = object(raw, ["id", "answer"]);
        if (typeof b.id !== "string" || !blankId.test(b.id) || blanks.has(b.id))
          fail();
        text(b.answer, COLLECTIONS_LIMITS.text, true);
        blanks.add(b.id);
      }
      const matches = [...e.text.matchAll(/\{\{([^{}]+)\}\}/g)].map(
        (match) => match[1]!,
      );
      if (
        matches.length !== blanks.size ||
        new Set(matches).size !== matches.length ||
        matches.some((key) => !blanks.has(key)) ||
        e.text.replace(/\{\{[^{}]+\}\}/g, "").includes("{{") ||
        e.text.replace(/\{\{[^{}]+\}\}/g, "").includes("}}")
      )
        fail();
    } else fail();
    return e;
  });
  const seenKeys = new Set<string>();
  unique(study.cards, (value) => {
    const c = object(value, ["id", "entryId", "key", "schedule", "revision"]);
    id(c.entryId);
    integer(c.revision, 1);
    schedule(c.schedule);
    const entry = entries.get(c.entryId);
    if (
      !entry ||
      typeof c.key !== "string" ||
      !derivedCardKeys(entry as StudyEntry).includes(c.key)
    )
      fail();
    const key = `${c.entryId}/${c.key}`;
    if (seenKeys.has(key)) fail();
    seenKeys.add(key);
    return c;
  });
  for (const entry of entries.values())
    for (const key of derivedCardKeys(entry as StudyEntry))
      if (!seenKeys.has(`${entry.id}/${key}`)) fail();
  unique(study.events, (value) => {
    const e = object(value, [
      "id",
      "cardId",
      "sessionId",
      "at",
      "grade",
      "algorithm",
      "before",
      "after",
      "undoneAt",
    ]);
    id(e.cardId);
    id(e.sessionId);
    date(e.at);
    if (
      !["again", "hard", "good", "easy"].includes(e.grade as string) ||
      e.algorithm !== "orbyn-interval-v1"
    )
      fail();
    const before = object(e.before, ["schedule", "cardRevision"]);
    const after = object(e.after, ["schedule", "cardRevision"]);
    schedule(before.schedule);
    schedule(after.schedule);
    integer(before.cardRevision, 1);
    integer(after.cardRevision, 2);
    if (after.cardRevision !== before.cardRevision + 1) fail();
    if (e.undoneAt !== null) {
      date(e.undoneAt);
      if (e.undoneAt < e.at) fail();
    }
    return e;
  });
  const p = object(study.preferences, [
    "algorithm",
    "timezone",
    "dayStartHour",
    "newPerDay",
    "reviewsPerDay",
    "showNextReview",
    "showStreak",
  ]);
  if (p.algorithm !== "orbyn-interval-v1") fail();
  text(p.timezone, 100, true);
  try {
    new Intl.DateTimeFormat("en", { timeZone: p.timezone });
  } catch {
    fail();
  }
  integer(p.dayStartHour, 0, 23);
  integer(p.newPerDay, 0, 10000);
  integer(p.reviewsPerDay, 0, 20000);
  bool(p.showNextReview);
  bool(p.showStreak);
  validateJournalEnvelope(row.journal);
  if (!legacy) validateClipState(row.clips);
  if (
    new TextEncoder().encode(JSON.stringify(value)).byteLength >
    (legacy ? LEGACY_COLLECTIONS_BYTES : COLLECTIONS_LIMITS.serializedBytes)
  )
    fail();
  return structuredClone(value as CollectionsState);
}
export function validateLegacyCollections(
  value: unknown,
): LegacyCollectionsState {
  return validateState(value, 1) as LegacyCollectionsState;
}
export function validateCollections(value: unknown): CollectionsState {
  return validateState(value, 3) as CollectionsState;
}
export function validateCollectionsV2(value: unknown): CollectionsStateV2 {
  return validateState(value, 2) as CollectionsStateV2;
}
export function normalizeCollections(value: unknown): CollectionsState {
  if ((value as { version?: unknown } | null)?.version === 1) {
    const legacy = validateLegacyCollections(value);
    return validateCollections({ ...legacy, version: 3, clips: emptyClips() });
  }
  if ((value as { version?: unknown } | null)?.version === 2)
    return validateCollections({ ...validateCollectionsV2(value), version: 3 });
  return validateCollections(value);
}
