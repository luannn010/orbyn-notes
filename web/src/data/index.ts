import type {
  AccountIdentity,
  Note,
  NoteDocument,
  NotesStore,
  PersistenceState,
} from "../domain/contracts";
import { RevisionConflictError } from "../domain/contracts";
import { validateInput, validateNotes } from "../domain/validation";
import { requireSession, onLock } from "../account/session";
import { loadEngine, DeviceKeys, SyncEngine } from "./engine";
import { readRecord, mutateRecord, wrappingSecret } from "./database";
import type { DeviceRecord } from "./database";
const ZONE = "notes-local";
const RECORD = "library";
export async function openNotesStore(
  identity: AccountIdentity,
): Promise<NotesStore> {
  requireSession(identity.accountId, identity.deviceId);
  await loadEngine();
  const initial = await readRecord<DeviceRecord>("devices", identity.email);
  if (
    !initial ||
    initial.accountId !== identity.accountId ||
    initial.deviceId !== identity.deviceId
  )
    throw new Error("keys_missing: This browser has no keys for this account.");
  const listeners = new Set<() => void>();
  let closed = false;
  let state: PersistenceState = { status: "ready" };
  const channel =
    typeof BroadcastChannel === "undefined"
      ? null
      : new BroadcastChannel(`orbyn-notes-library:${identity.accountId}`);
  function notify() {
    for (const listener of listeners) listener();
  }
  function assertOpen() {
    if (closed) throw new Error("locked: This library is closed.");
    requireSession(identity.accountId, identity.deviceId);
  }
  const unsubscribeLock = onLock(close);
  function close() {
    if (closed) return;
    closed = true;
    unsubscribeLock();
    channel?.close();
    listeners.clear();
  }
  channel?.addEventListener("message", notify);
  async function access<T>(
    change: ((notes: Note[]) => { notes: Note[]; result: T }) | null,
    project?: (notes: Note[]) => T,
  ): Promise<T> {
    assertOpen();
    const secret = await wrappingSecret(initial!.wrapKey);
    let result: T | undefined;
    function apply(record: DeviceRecord | undefined): DeviceRecord {
      assertOpen();
      if (
        !record ||
        record.accountId !== identity.accountId ||
        record.deviceId !== identity.deviceId
      )
        throw new Error("keys_missing: Account device changed. Sign in again.");
      const keys = DeviceKeys.import(record.sealedKeys, secret);
      let engine: SyncEngine | undefined;
      try {
        engine = record.snapshot
          ? SyncEngine.restore(keys, record.snapshot, secret, Date.now())
          : SyncEngine.create(keys, record.accountId, record.deviceId);
        const raw = engine.record(ZONE, RECORD);
        const notes = raw
          ? validateNotes(JSON.parse(raw).fields.notes.value)
          : [];
        if (!change) {
          result = project!(notes);
          return record;
        }
        const next = change(notes);
        validateNotes(next.notes);
        if (!raw) engine.createZoneKey(ZONE);
        engine.stage(
          ZONE,
          "notes_library",
          RECORD,
          JSON.stringify({
            notes: {
              value: next.notes,
              stamp: JSON.parse(engine.tick(Date.now())),
            },
          }),
        );
        result = next.result;
        return {
          ...record,
          snapshot: engine.snapshot(secret),
          generation: record.generation + 1,
        };
      } finally {
        engine?.free();
        keys.free();
      }
    }
    try {
      if (change) {
        state = { status: "saving" };
        notify();
        await mutateRecord<DeviceRecord>("devices", identity.email, apply);
        state = { status: "ready" };
        channel?.postMessage("changed");
        notify();
      } else {
        apply(await readRecord<DeviceRecord>("devices", identity.email));
      }
      return result as T;
    } catch (error) {
      if (change) {
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
  function revise(
    id: string,
    expectedRevision: number,
    transform: (note: Note) => Note,
  ): Promise<Note> {
    return access((notes) => {
      const index = notes.findIndex((n) => n.id === id);
      if (index < 0)
        throw new Error("note_missing: This note no longer exists.");
      const current = notes[index]!;
      const attempted = transform({
        ...current,
        revision: expectedRevision + 1,
        updatedAt: new Date().toISOString(),
      });
      if (current.revision !== expectedRevision)
        throw new RevisionConflictError(
          structuredClone(current),
          structuredClone(attempted),
        );
      notes[index] = attempted;
      return { notes, result: structuredClone(attempted) };
    });
  }
  // Read and authenticate the existing sealed snapshot before reporting ready.
  try {
    await access(null, (notes) => notes.length);
  } catch (error) {
    close();
    throw error;
  }
  return {
    list: () => access(null, (notes) => structuredClone(notes)),
    get: (id) =>
      access(null, (notes) =>
        structuredClone(notes.find((n) => n.id === id) ?? null),
      ),
    create: async (input) => {
      const checked = validateInput(input);
      return access((notes) => {
        const now = new Date().toISOString();
        const note: Note = {
          ...checked,
          id: crypto.randomUUID(),
          createdAt: now,
          updatedAt: now,
          trashedAt: null,
          revision: 1,
        };
        notes.push(note);
        return { notes, result: structuredClone(note) };
      });
    },
    update: async (id, patch, revision) => {
      const stable = structuredClone(patch);
      return revise(id, revision, (n) => ({
        ...n,
        ...validateInput({
          title: stable.title ?? n.title,
          document: stable.document ?? n.document,
          tags: stable.tags ?? n.tags,
        }),
      }));
    },
    trash: (id, revision) =>
      revise(id, revision, (n) => ({
        ...n,
        trashedAt: new Date().toISOString(),
      })),
    restore: (id, revision) =>
      revise(id, revision, (n) => ({ ...n, trashedAt: null })),
    erase: () => access((notes) => ({ notes: [], result: undefined })),
    subscribe: (listener) => {
      assertOpen();
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    persistence: () => ({ ...state }),
    close,
  };
}
