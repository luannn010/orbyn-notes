import type { NoteTarget } from "../links/contracts";
import { decodeNoteReference } from "../links/reference";

export interface NativeNoteLinkBridge {
  listen(onSequence: (sequence: unknown) => void): Promise<() => void>;
  snapshot(): Promise<unknown>;
  ack(sequence: number): Promise<unknown>;
  retire(): Promise<unknown>;
}
export interface NativeNoteLinkIngress {
  start(
    handoff: (target: NoteTarget, sequence: number) => boolean,
    onInvalid?: () => void,
    onError?: () => void,
  ): Promise<void>;
  refresh(): Promise<void>;
  retire(): Promise<void>;
  stop(): Promise<void>;
}
function sequence(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length !== keys.length ||
    !keys.every((key) => Object.hasOwn(value, key))
  )
    throw new Error("Invalid native reference response.");
  return value as Record<string, unknown>;
}
export function createNativeNoteLinkIngress(
  bridge: NativeNoteLinkBridge,
): NativeNoteLinkIngress {
  let connection = 0,
    generation = 0,
    watermark = 0,
    observed = 0;
  let barriers = 0,
    failedBarrier = false,
    running = false,
    listening = false;
  let unlisten: (() => void) | null = null;
  let handoff: ((target: NoteTarget, sequence: number) => boolean) | null =
    null;
  let onInvalid: (() => void) | undefined;
  let onError: (() => void) | undefined;
  let latestRequest: object | null = null;
  function backgroundRefresh() {
    const ticket = connection,
      captured = generation,
      work = refresh(),
      request = latestRequest;
    void work.catch(() => {
      if (
        !running ||
        ticket !== connection ||
        captured !== generation ||
        request !== latestRequest
      )
        return;
      try {
        onError?.();
      } catch {
        /* Notice does not control broker state. */
      }
    });
  }
  const paused = () => barriers > 0 || failedBarrier;
  async function refresh(): Promise<void> {
    if (!running || !listening || paused()) return;
    const ticket = connection,
      captured = generation;
    const request = {};
    latestRequest = request;
    try {
      const raw = await bridge.snapshot();
      if (
        !running ||
        paused() ||
        ticket !== connection ||
        captured !== generation
      )
        return;
      const snapshot = object(raw, ["sequence", "pending"]);
      if (!sequence(snapshot.sequence))
        throw new Error("Invalid native reference sequence.");
      const current = snapshot.sequence;
      if (current < observed || current <= watermark) return;
      observed = Math.max(observed, current);
      if (snapshot.pending === null) {
        watermark = Math.max(watermark, current);
        return;
      }
      const pending = object(snapshot.pending, ["sequence", "uri"]);
      if (
        pending.sequence !== current ||
        current === 0 ||
        typeof pending.uri !== "string" ||
        pending.uri.length > 8192
      )
        throw new Error("Invalid native reference pending value.");
      let target: NoteTarget;
      try {
        target = decodeNoteReference(pending.uri);
      } catch {
        watermark = Math.max(watermark, current);
        try {
          onInvalid?.();
        } catch {
          /* Notice does not control retirement. */
        }
        if (ticket === connection && captured === generation && !paused())
          await bridge.ack(current);
        return;
      }
      if (!handoff?.(target, current)) return;
      if (
        !running ||
        paused() ||
        ticket !== connection ||
        captured !== generation
      )
        return;
      // Consumption is a validated controller handoff, never navigation success.
      watermark = Math.max(watermark, current);
      await bridge.ack(current);
    } catch (error) {
      if (
        !running ||
        ticket !== connection ||
        captured !== generation ||
        request !== latestRequest
      )
        return;
      throw error;
    }
  }
  async function retire(): Promise<void> {
    generation++; // Synchronous fence before the native command can await.
    if (barriers === 0) failedBarrier = false;
    barriers++;
    try {
      const result = object(await bridge.retire(), ["sequence"]);
      if (!sequence(result.sequence))
        throw new Error("Invalid native retirement sequence.");
      watermark = Math.max(watermark, result.sequence);
      observed = Math.max(observed, result.sequence);
    } catch (error) {
      failedBarrier = true;
      throw error;
    } finally {
      barriers--;
      if (!paused() && running) backgroundRefresh();
    }
  }
  return {
    async start(nextHandoff, nextInvalid, nextError) {
      const ticket = ++connection;
      generation++;
      listening = false;
      unlisten?.();
      unlisten = null;
      running = true;
      handoff = nextHandoff;
      onInvalid = nextInvalid;
      onError = nextError;
      const cleanup = await bridge.listen((value) => {
        if (
          ticket !== connection ||
          !running ||
          !sequence(value) ||
          value === 0 ||
          value <= watermark ||
          value <= observed
        )
          return;
        observed = Math.max(observed, value);
        if (failedBarrier) {
          try {
            onError?.();
          } catch {
            /* Notice is not authorization. */
          }
          return;
        }
        backgroundRefresh();
      });
      if (!running || ticket !== connection) {
        cleanup();
        return;
      }
      unlisten = cleanup;
      listening = true;
      // Listener is installed before the initial snapshot. A newer request
      // also fences a late startup rejection before the caller can report it.
      const work = refresh(),
        request = latestRequest,
        captured = generation;
      try {
        await work;
      } catch (error) {
        if (
          running &&
          ticket === connection &&
          captured === generation &&
          request === latestRequest
        )
          throw error;
      }
    },
    refresh,
    retire,
    async stop() {
      running = false;
      listening = false;
      connection++;
      generation++;
      handoff = null;
      onInvalid = undefined;
      onError = undefined;
      unlisten?.();
      unlisten = null;
      await retire();
    },
  };
}
const nativeBridge: NativeNoteLinkBridge = {
  async listen(onSequence) {
    const { listen } = await import("@tauri-apps/api/event");
    return listen<{ sequence: number }>(
      "notes-reference-pending",
      (event) => onSequence(event.payload?.sequence),
      { target: { kind: "WebviewWindow", label: "main" } },
    );
  },
  async snapshot() {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke("note_link_snapshot");
  },
  async ack(value) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke("note_link_ack", { sequence: value });
  },
  async retire() {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke("note_link_retire");
  },
};
// App lifetime: do not recreate this owner on account/epoch/React hook changes.
export const nativeNoteLinkIngress = createNativeNoteLinkIngress(nativeBridge);
