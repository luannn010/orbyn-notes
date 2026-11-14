import { lockVersion, onLock } from "../account/session";
import { onCollectionsEpochChange } from "../collections/store";
import { CollectionsRevisionConflictError } from "../collections/contracts";
import type {
  CollectionsRevision,
  CollectionsState,
  CollectionsStore,
} from "../collections/contracts";
import { ClipConflictError, ClipError } from "./contracts";
import type {
  ClipActionInput,
  ClipIntent,
  ClipMutationResult,
  ClipReceipt,
  ClipSnapshot,
  ClipsStore,
} from "./contracts";
import { applyClipAction } from "./model";
import { id, integer, object, validateClipAction } from "./validation";

type Prepared = {
  expected: CollectionsRevision;
  action: ClipActionInput;
  operationId: string;
  clipId: string;
  preparedAt: string;
  digest: string;
  generation: number;
};
function snapshot(state: CollectionsState): ClipSnapshot {
  return structuredClone({
    epoch: state.epoch,
    revision: state.revision,
    clips: state.clips,
  });
}
export function createClipsStore(collections: CollectionsStore): ClipsStore {
  let closed = false,
    generation = 0;
  const openedLock = lockVersion();
  let intents = new WeakMap<ClipIntent, Prepared>();
  const listeners = new Set<() => void>(),
    invalidations = new Set<(reason: "epoch" | "closed") => void>();
  const stopLock = onLock(close);
  let stopEpoch: () => void, stopChange: () => void;
  try {
    stopEpoch = onCollectionsEpochChange(collections, () =>
      invalidate("epoch"),
    );
    stopChange = collections.subscribe(notify);
  } catch (error) {
    stopLock();
    throw error;
  }
  function notify() {
    if (!closed)
      for (const listener of listeners) {
        try {
          listener();
        } catch {
          /* Observer isolation. */
        }
      }
  }
  function invalidate(reason: "epoch" | "closed") {
    generation++;
    intents = new WeakMap();
    for (const listener of invalidations) {
      try {
        listener(reason);
      } catch {
        /* Revocation always completes. */
      }
    }
  }
  function close() {
    if (closed) return;
    closed = true;
    invalidate("closed");
    stopLock();
    stopEpoch?.();
    stopChange?.();
    listeners.clear();
    invalidations.clear();
  }
  function guard(captured = generation) {
    if (closed || openedLock !== lockVersion() || captured !== generation)
      throw new ClipError(
        "clip_intent_revoked",
        "This clip operation is no longer authorized.",
      );
  }
  async function read() {
    guard();
    const captured = generation;
    const state = await collections.read();
    guard(captured);
    return snapshot(state);
  }
  function reconcile(
    state: CollectionsState,
    prepared: Prepared,
  ): ClipMutationResult | null {
    guard(prepared.generation);
    if (state.epoch !== prepared.expected.epoch)
      throw new ClipError(
        "clip_intent_revoked",
        "The workspace was erased. Reload Clips.",
      );
    const receipt = state.clips.receipts.find(
      (row) => row.operationId === prepared.operationId,
    );
    if (!receipt) return null;
    if (receipt.digest !== prepared.digest)
      throw new ClipError(
        "clip_operation_reused",
        "This operation identity has different saved content.",
      );
    return {
      snapshot: snapshot(state),
      receipt: structuredClone(receipt),
      changed: receipt.changed,
      replayed: true,
    };
  }
  return {
    read,
    async prepare(expectedInput, input) {
      guard();
      const token = object(
        { epoch: expectedInput?.epoch, revision: expectedInput?.revision },
        ["epoch", "revision"],
      );
      id(token.epoch);
      integer(token.revision);
      const expected = { epoch: token.epoch, revision: token.revision };
      // Validation returns a fresh primitive-only action, captured before awaits.
      const action = validateClipAction(input),
        captured = generation;
      const operationId = crypto.randomUUID(),
        preparedAt = new Date().toISOString();
      const state = await collections.read();
      guard(captured);
      if (state.epoch !== expected.epoch)
        throw new ClipError(
          "clip_intent_revoked",
          "The workspace changed. Reload Clips.",
        );
      const clipId =
        action.kind === "create"
          ? operationId
          : action.kind === "undo-create"
            ? state.clips.receipts.find(
                (row) =>
                  row.operationId === action.receiptOperationId &&
                  row.kind === "create",
              )?.clipId
            : action.clipId;
      if (!clipId)
        throw new ClipError(
          "clip_undo_unavailable",
          "The original save receipt is no longer available.",
        );
      const canonicalAction = Object.fromEntries(
        Object.entries(action).sort(([a], [b]) => a.localeCompare(b)),
      );
      const bytes = new TextEncoder().encode(
        JSON.stringify({
          expected,
          action: canonicalAction,
          operationId,
          clipId,
          preparedAt,
        }),
      );
      let digest: string;
      try {
        digest = Array.from(
          new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
          (byte) => byte.toString(16).padStart(2, "0"),
        ).join("");
      } finally {
        bytes.fill(0);
      }
      guard(captured);
      const latest = await collections.read();
      guard(captured);
      if (latest.epoch !== expected.epoch)
        throw new ClipError(
          "clip_intent_revoked",
          "The workspace changed. Reload Clips.",
        );
      const intent = Object.freeze({ operationId, clipId }) as ClipIntent;
      intents.set(intent, {
        expected,
        action,
        operationId,
        clipId,
        preparedAt,
        digest,
        generation: captured,
      });
      return intent;
    },
    async commit(intent) {
      guard();
      const prepared = intent && intents.get(intent);
      if (!prepared)
        throw new ClipError(
          "clip_intent_revoked",
          "Prepare a new authorized clip operation.",
        );
      guard(prepared.generation);
      const current = await collections.read();
      const replay = reconcile(current, prepared);
      if (replay) return replay;
      let receipt: ClipReceipt | undefined;
      try {
        const saved = await collections.update(prepared.expected, (current) => {
          guard(prepared.generation);
          const result = applyClipAction(
            current.clips,
            prepared.action,
            prepared.operationId,
            prepared.clipId,
            prepared.digest,
            prepared.preparedAt,
          );
          receipt = result.receipt;
          return { ...current, clips: result.clips };
        });
        guard(prepared.generation);
        return {
          snapshot: snapshot(saved),
          receipt: structuredClone(receipt!),
          changed: receipt!.changed,
          replayed: false,
        };
      } catch (error) {
        guard(prepared.generation);
        if (error instanceof CollectionsRevisionConflictError) {
          const replay = reconcile(error.current, prepared);
          if (replay) return replay;
          throw new ClipConflictError(snapshot(error.current));
        }
        throw error;
      }
    },
    subscribe(listener) {
      guard();
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    onInvalidate(listener) {
      guard();
      invalidations.add(listener);
      return () => invalidations.delete(listener);
    },
    persistence: () => collections.persistence(),
    close,
  };
}
