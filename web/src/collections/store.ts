import { SearchSourceError } from "../search/contracts";
import {
  createSearchAdmission,
  collectionsSearchData,
  type SearchOwnerAccess,
  type CollectionsSearchData,
} from "../search/source";
import type { AccountIdentity, PersistenceState } from "../domain/contracts";
import { lockVersion, onLock, requireSession } from "../account/session";
import { loadEngine, DeviceKeys, SyncEngine } from "../data/engine";
import {
  mutateRecord,
  readRecord,
  wrappingSecret,
  UNCHANGED_RECORD,
} from "../data/database";
import type { DeviceRecord } from "../data/database";
import type {
  CollectionsState,
  CollectionsRevision,
  CollectionsStore,
  JournalEnvelope,
} from "./contracts";
import { CollectionsRevisionConflictError } from "./contracts";
import {
  COLLECTIONS_LIMITS,
  emptyStudy,
  validateCollections,
  validateJournalEnvelope,
  normalizeCollections,
} from "./validation";
import { emptyClips } from "../clips/validation";

export const COLLECTIONS_ZONE = "notes-collections-v1";
const RECORD = "workspace";
type Internal = {
  assertOpen(): void;
  search: SearchOwnerAccess;
  replace(
    expected: CollectionsRevision,
    envelope: JournalEnvelope | null,
    current?: () => void,
  ): Promise<CollectionsState>;
  epochListeners: Set<(epoch: string) => void>;
  closeListeners: Set<() => void>;
};
const internals = new WeakMap<CollectionsStore, Internal>();

export function collectionsSearchAdmission(
  store: CollectionsStore,
): SearchOwnerAccess {
  const owner = internals.get(store);
  if (!owner)
    throw new Error(
      "search_source_invalid: Genuine Collections owner required.",
    );
  return owner.search;
}
function freshState(revision = 0): CollectionsState {
  let timezone = "UTC";
  try {
    const local = Intl.DateTimeFormat().resolvedOptions().timeZone;
    new Intl.DateTimeFormat("en", { timeZone: local });
    if (typeof local === "string" && local) timezone = local;
  } catch {
    /* A host without valid timezone data uses the explicit UTC fallback. */
  }
  return {
    version: 3,
    epoch: crypto.randomUUID(),
    revision,
    study: emptyStudy(timezone),
    journal: null,
    clips: emptyClips(),
  };
}
function readEngine(engine: SyncEngine): CollectionsState | null {
  const raw = engine.record(COLLECTIONS_ZONE, RECORD);
  if (!raw) return null;
  if (raw.length > COLLECTIONS_LIMITS.serializedBytes * 2)
    throw new Error("collections_invalid: Collections payload is too large.");
  const decoded: unknown = JSON.parse(raw);
  const wrapper = decoded as {
    record_type?: unknown;
    fields?: { collections?: { value?: unknown } };
  };
  if (wrapper?.record_type !== "notes_collections")
    throw new Error(
      "collections_invalid: Collections record owner is not valid.",
    );
  return normalizeCollections(wrapper?.fields?.collections?.value);
}
function stage(
  engine: SyncEngine,
  state: CollectionsState,
  exists: boolean,
): void {
  validateCollections(state);
  if (!exists) engine.createZoneKey(COLLECTIONS_ZONE);
  engine.stage(
    COLLECTIONS_ZONE,
    "notes_collections",
    RECORD,
    JSON.stringify({
      collections: { value: state, stamp: JSON.parse(engine.tick(Date.now())) },
    }),
  );
}
/** Capture before zone purge; invoke after purge in the SAME synchronous snapshot transaction. */
export function prepareCollectionsErase(engine: SyncEngine): () => void {
  const current = readEngine(engine);
  if (current?.revision === Number.MAX_SAFE_INTEGER)
    throw new Error(
      "collections_revision_exhausted: Collections cannot be changed safely.",
    );
  const replacement = freshState((current?.revision ?? 0) + 1);
  return () => stage(engine, replacement, false);
}
/** Internal cross-domain writer hooks. No independent snapshot or asynchronous callback. */
export function readCollectionsForTransaction(
  engine: SyncEngine,
): CollectionsState {
  const state = readEngine(engine);
  if (!state)
    throw new Error(
      "collections_missing: Open Study before creating a source card.",
    );
  return state;
}
export function stageCollectionsForTransaction(
  engine: SyncEngine,
  state: CollectionsState,
): void {
  stage(engine, validateCollections(state), true);
}
export function assertCollectionsAccess(store: CollectionsStore): void {
  const owner = internals.get(store);
  if (!owner) throw new Error("locked: Collections owner is unavailable.");
  owner.assertOpen();
}
/** Private consumers revoke immediately when their borrowed genuine owner closes. */
export function onCollectionsClose(
  store: CollectionsStore,
  listener: () => void,
): () => void {
  const owner = internals.get(store);
  if (!owner) throw new Error("locked: Collections owner is unavailable.");
  owner.assertOpen();
  owner.closeListeners.add(listener);
  return () => owner.closeListeners.delete(listener);
}
/** Internal JournalVault boundary; intentionally absent from the general store interface. */
export function replaceJournal(
  store: CollectionsStore,
  expected: CollectionsRevision,
  envelope: JournalEnvelope | null,
  current?: () => void,
): Promise<CollectionsState> {
  const internal = internals.get(store);
  if (!internal)
    return Promise.reject(new Error("locked: Collections are closed."));
  return internal.replace(expected, envelope, current);
}
/** Vault revokes leases synchronously before ordinary change subscribers see a new epoch. */
export function onCollectionsEpochChange(
  store: CollectionsStore,
  listener: (epoch: string) => void,
): () => void {
  const internal = internals.get(store);
  if (!internal) throw new Error("locked: Collections are closed.");
  internal.assertOpen();
  internal.epochListeners.add(listener);
  return () => internal.epochListeners.delete(listener);
}
function sameEnvelope(
  a: JournalEnvelope | null,
  b: JournalEnvelope | null,
): boolean {
  return a === null || b === null
    ? a === b
    : a.version === b.version &&
        a.kdf.name === b.kdf.name &&
        a.kdf.iterations === b.kdf.iterations &&
        a.kdf.salt === b.kdf.salt &&
        a.iv === b.iv &&
        a.ciphertext === b.ciphertext;
}
function sameHistory(
  current: CollectionsState,
  next: CollectionsState,
): boolean {
  const events = new Map(next.study.events.map((event) => [event.id, event]));
  return current.study.events.every((event) => {
    const after = events.get(event.id);
    return (
      after &&
      sameValue({ ...after, undoneAt: event.undoneAt }, event) &&
      (event.undoneAt === null || after.undoneAt === event.undoneAt)
    );
  });
}
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  const left = a as Record<string, unknown>,
    right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  return (
    keys.length === Object.keys(right).length &&
    keys.every(
      (key) => Object.hasOwn(right, key) && sameValue(left[key], right[key]),
    )
  );
}

export async function openCollectionsStore(
  input: AccountIdentity,
): Promise<CollectionsStore> {
  const identity = structuredClone(input);
  const openedVersion = lockVersion();
  requireSession(identity.accountId, identity.deviceId);
  let closed = false;
  let searchAdmission: ReturnType<typeof createSearchAdmission> | null = null;
  let observedEpoch: string | undefined;
  let persistence: PersistenceState = { status: "ready" };
  const listeners = new Set<() => void>();
  const epochListeners = new Set<(epoch: string) => void>();
  const closeListeners = new Set<() => void>();
  let channel: BroadcastChannel | null = null;
  const stopLock = onLock(close);
  function assertOpen() {
    if (closed || lockVersion() !== openedVersion)
      throw new Error("locked: Collections are closed.");
    requireSession(identity.accountId, identity.deviceId);
  }
  function close() {
    if (closed) return;
    closed = true;
    searchAdmission?.close();
    for (const listener of closeListeners) {
      try {
        listener();
      } catch {
        /* One consumer cannot prevent the remaining consumers from revoking. */
      }
    }
    closeListeners.clear();
    stopLock();
    channel?.close();
    listeners.clear();
    epochListeners.clear();
  }
  function notify() {
    if (closed) return;
    for (const listener of listeners) {
      try {
        listener();
      } catch {
        /* An observer cannot change commit results. */
      }
    }
  }
  function observe(state: CollectionsState) {
    assertOpen();
    if (observedEpoch !== undefined && observedEpoch !== state.epoch) {
      for (const listener of epochListeners) listener(state.epoch);
    }
    observedEpoch = state.epoch;
  }
  let initial: DeviceRecord;
  try {
    await loadEngine();
    assertOpen();
    const found = await readRecord<DeviceRecord>("devices", identity.email);
    assertOpen();
    if (
      !found ||
      found.accountId !== identity.accountId ||
      found.deviceId !== identity.deviceId
    )
      throw new Error("keys_missing: Device keys are unavailable.");
    initial = found;
    searchAdmission = createSearchAdmission(
      identity,
      initial.wrapKey,
      assertOpen,
      async () => {
        await access(null);
      },
    );
    channel =
      typeof BroadcastChannel === "undefined"
        ? null
        : new BroadcastChannel(`orbyn-notes-library:${identity.accountId}`);
    channel?.addEventListener("message", () => {
      searchAdmission?.unverified();
      void access(null)
        .then(() => notify())
        .catch(() => {
          if (!closed) {
            persistence = {
              status: "failed",
              message: "Collections could not be refreshed.",
            };
            notify();
          }
        });
    });
    // Persist exactly one initial epoch atomically and authenticate before reporting readiness.
    await access(null, true);
  } catch (error) {
    close();
    throw error;
  }

  async function access(
    change: ((current: CollectionsState) => CollectionsState) | null,
    initialize = false,
    beforeStage?: () => void,
  ): Promise<CollectionsState> {
    assertOpen();
    const secret = await wrappingSecret(initial.wrapKey);
    try {
      assertOpen();
      let result: CollectionsState | undefined;
      let searchCandidate: {
        record: DeviceRecord;
        before?: DeviceRecord;
        data: CollectionsSearchData | null;
      } | null = null;
      function apply(
        record: DeviceRecord | undefined,
      ): DeviceRecord | typeof UNCHANGED_RECORD {
        assertOpen();
        if (
          !record ||
          record.accountId !== identity.accountId ||
          record.deviceId !== identity.deviceId
        )
          throw new Error("keys_missing: Device keys changed.");
        const keys = DeviceKeys.import(record.sealedKeys, secret);
        let engine: SyncEngine | undefined;
        try {
          engine = record.snapshot
            ? SyncEngine.restore(keys, record.snapshot, secret, Date.now())
            : SyncEngine.create(keys, record.accountId, record.deviceId);
          const persisted = readEngine(engine);
          if (!persisted && !initialize)
            throw new Error(
              "collections_missing: Reopen the workspace before retrying.",
            );
          const current = persisted ?? freshState();
          result = change
            ? validateCollections(change(structuredClone(current)))
            : current;
          assertOpen();
          if (!persisted || change) {
            const guarded: unknown = beforeStage?.();
            if (
              guarded &&
              typeof (guarded as { then?: unknown }).then === "function"
            ) {
              void Promise.resolve(guarded).catch(() => {});
              throw new Error(
                "collections_invalid: Commit freshness checks must be synchronous.",
              );
            }
            stage(engine, result, persisted !== null);
            const nextRecord = {
              ...record,
              snapshot: engine.snapshot(secret),
              generation: record.generation + 1,
            };
            if (searchAdmission)
              searchCandidate = {
                record: nextRecord,
                before: record,
                data: collectionsSearchData(result),
              };
            return nextRecord;
          }
          if (searchAdmission)
            searchCandidate = {
              record,
              data: searchAdmission.sameImage(record)
                ? null
                : collectionsSearchData(result),
            };
          return UNCHANGED_RECORD;
        } finally {
          engine?.free();
          keys.free();
        }
      }
      if (change || initialize)
        await mutateRecord<DeviceRecord>("devices", identity.email, apply);
      else {
        const record = await readRecord<DeviceRecord>(
          "devices",
          identity.email,
        );
        assertOpen();
        apply(record);
      }
      if (searchCandidate && searchAdmission) {
        const candidate = searchCandidate as {
          record: DeviceRecord;
          before?: DeviceRecord;
          data: CollectionsSearchData | null;
        };
        try {
          await searchAdmission.publish(
            candidate.record,
            candidate.data,
            candidate.before,
          );
        } catch {
          /* Search failure cannot change an already committed Collections outcome. */
        }
      }
      assertOpen();
      observe(result!);
      assertOpen();
      return structuredClone(result!);
    } finally {
      secret.fill(0);
    }
  }
  async function commit(
    expectedInput: CollectionsRevision,
    change: (current: CollectionsState) => CollectionsState,
    journalAllowed: boolean,
    currentGuard?: () => void,
  ): Promise<CollectionsState> {
    const expected = structuredClone(expectedInput);
    if (
      !expected ||
      typeof expected.epoch !== "string" ||
      !Number.isSafeInteger(expected.revision) ||
      expected.revision < 0 ||
      typeof change !== "function"
    )
      throw new Error("collections_invalid: Invalid mutation request.");
    assertOpen();
    persistence = { status: "saving" };
    notify();
    try {
      const result = await access(
        (current) => {
          if (
            current.epoch !== expected.epoch ||
            current.revision !== expected.revision
          )
            throw new CollectionsRevisionConflictError(
              structuredClone(current),
            );
          const attempted = change(structuredClone(current));
          if (
            attempted &&
            typeof (attempted as unknown as { then?: unknown }).then ===
              "function"
          ) {
            void Promise.resolve(attempted).catch(() => {});
            throw new Error(
              "collections_invalid: Collection mutations must be synchronous.",
            );
          }
          const next = validateCollections(attempted);
          const currentSources = new Map(
            current.study.entries.map((entry) => [entry.id, entry.source]),
          );
          for (const entry of next.study.entries) {
            if (entry.source && "version" in entry.source) {
              const original = currentSources.get(entry.id);
              if (JSON.stringify(entry.source) !== JSON.stringify(original))
                throw new Error(
                  "collections_invalid: Anchored source birth belongs to the source writer.",
                );
            }
          }
          if (
            next.version !== current.version ||
            next.epoch !== current.epoch ||
            next.revision !== current.revision ||
            (!journalAllowed && !sameEnvelope(current.journal, next.journal)) ||
            !sameHistory(current, next)
          )
            throw new Error(
              "collections_invalid: Mutation changed store-owned data.",
            );
          if (current.revision === Number.MAX_SAFE_INTEGER)
            throw new Error(
              "collections_revision_exhausted: Collections cannot be changed safely.",
            );
          return { ...next, revision: current.revision + 1 };
        },
        false,
        currentGuard,
      );
      assertOpen();
      persistence = { status: "ready" };
      channel?.postMessage("changed");
      notify();
      assertOpen();
      return result;
    } catch (error) {
      if (!closed) {
        persistence = {
          status: "failed",
          message: "Collections could not be saved. Reload before retrying.",
        };
        notify();
      }
      throw error;
    }
  }
  const store: CollectionsStore = {
    read: () => access(null),
    update: (expected, change) => commit(expected, change, false),
    subscribe: (listener) => {
      assertOpen();
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    persistence: () => ({ ...persistence }),
    close,
  };
  internals.set(store, {
    search: searchAdmission!.access,
    assertOpen,
    epochListeners,
    closeListeners,
    replace: (expected, envelope, current) => {
      const stable = validateJournalEnvelope(envelope);
      return commit(
        expected,
        (current) => ({ ...current, journal: stable }),
        true,
        current,
      );
    },
  });
  return store;
}
