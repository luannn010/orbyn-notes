import { SyncEngine } from "../data/engine";
import { validateNotes } from "../domain/validation";
import type { Note } from "../domain/contracts";
import type { LibraryState, LibraryCommonState } from "./contracts";
import { LibraryCapacityError } from "./contracts";
import { adoptLibrary } from "./model";
import {
  invalid,
  LIBRARY_LIMITS,
  validateLibrary,
  normalizeLibrary,
  validateLibraryCommon,
} from "./validation";
export const CORE_ZONE = "notes-local";
const CORE_RECORD = "library";
export const LIBRARY_ZONE = "notes-library-v1";
const LIBRARY_RECORD = "workspace";
export function readCore(
  engine: SyncEngine,
  policy: "plain" | "notes" = "plain",
): {
  notes: Note[];
  original: unknown[];
  exists: boolean;
  identity: string;
} {
  const raw = engine.record(CORE_ZONE, CORE_RECORD);
  const record = raw ? JSON.parse(raw) : null;
  if (record && record.record_type !== "notes_library") invalid();
  const original = record ? record.fields.notes.value : [];
  return {
    notes: validateNotes(original, policy),
    original,
    exists: raw !== undefined,
    identity: raw ?? "<absent>",
  };
}
export function readLibraryEnvelope(engine: SyncEngine): {
  value: unknown | null;
  identity: string;
} {
  const raw = engine.record(LIBRARY_ZONE, LIBRARY_RECORD);
  if (!raw) return { value: null, identity: "<absent>" };
  if (raw.length > LIBRARY_LIMITS.bytes * 2) throw new LibraryCapacityError();
  const record = JSON.parse(raw);
  if (record.record_type !== "notes_library_metadata") invalid();
  const value: unknown = record.fields?.library?.value;
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  return { value, identity: raw };
}
export function readLibraryHeader(engine: SyncEngine): unknown | null {
  return readLibraryEnvelope(engine).value;
}
export function readLibrary(
  engine: SyncEngine,
  notes: Note[],
): LibraryState | null {
  const value = readLibraryHeader(engine);
  return value === null ? null : normalizeLibrary(value, notes);
}
export function readLibraryCommon(
  value: unknown,
  notes: Note[],
): LibraryCommonState | null {
  if (value === null) return null;
  return (value as { version?: unknown }).version === 3
    ? validateLibraryCommon(value, notes)
    : normalizeLibrary(value, notes);
}
export function adopt(
  engine: SyncEngine,
  notes: Note[],
  original: unknown[],
  now: string,
): LibraryState {
  return validateLibrary(adoptLibrary(notes, original, now), notes);
}
export function stageCore(
  engine: SyncEngine,
  notes: Note[],
  exists: boolean,
  policy: "plain" | "notes" = "plain",
): void {
  validateNotes(notes, policy);
  if (!exists) engine.createZoneKey(CORE_ZONE);
  engine.stage(
    CORE_ZONE,
    "notes_library",
    CORE_RECORD,
    JSON.stringify({
      notes: { value: notes, stamp: JSON.parse(engine.tick(Date.now())) },
    }),
  );
}
export function stageLibrary(
  engine: SyncEngine,
  state: LibraryState,
  notes: Note[],
  exists: boolean,
): void {
  validateLibrary(state, notes);
  if (!exists) engine.createZoneKey(LIBRARY_ZONE);
  engine.stage(
    LIBRARY_ZONE,
    "notes_library_metadata",
    LIBRARY_RECORD,
    JSON.stringify({
      library: { value: state, stamp: JSON.parse(engine.tick(Date.now())) },
    }),
  );
}
