// @vitest-environment node
import { expect, it, vi } from "vitest";
import {
  createNativeNoteLinkIngress,
  nativeNoteLinkIngress,
  type NativeNoteLinkBridge,
} from "../../src/desktop/noteLinks";
import type { NoteTarget } from "../../src/links/contracts";
import { encodeNoteReference } from "../../src/links/reference";
const nativeWiring = vi.hoisted(() => ({ listen: vi.fn(), invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: nativeWiring.listen }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: nativeWiring.invoke }));
const target = {
  kind: "note" as const,
  accountId: "11111111-1111-4111-8111-111111111111",
  libraryEpoch: "22222222-2222-4222-8222-222222222222",
  noteId: "opaque",
};
const uri = encodeNoteReference(target);
const turn = () => new Promise<void>((resolve) => setImmediate(resolve));
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function broker() {
  let sequence = 0,
    pending: null | { sequence: number; uri: string } = null;
  const listeners = new Set<(value: unknown) => void>();
  const bridge: NativeNoteLinkBridge = {
    listen: vi.fn(async (callback) => {
      listeners.add(callback);
      return () => listeners.delete(callback);
    }),
    snapshot: vi.fn(async () => structuredClone({ sequence, pending })),
    ack: vi.fn(async (value) => {
      if (pending?.sequence !== value) return false;
      pending = null;
      return true;
    }),
    retire: vi.fn(async () => {
      pending = null;
      return { sequence: ++sequence };
    }),
  };
  return {
    bridge,
    activate(value = uri) {
      pending = { sequence: ++sequence, uri: value };
      for (const listener of listeners) listener(sequence);
      return sequence;
    },
    notify(value: unknown) {
      for (const listener of listeners) listener(value);
    },
    current: () => ({ sequence, pending }),
  };
}
it("installs listener before startup snapshot and consumes only validated controller handoff", async () => {
  const native = broker();
  native.activate();
  const handoff = vi.fn((_target: NoteTarget, _sequence: number) => true),
    transport = createNativeNoteLinkIngress(native.bridge);
  await transport.start(handoff);
  expect(handoff).toHaveBeenCalledWith(target, 1);
  expect(native.bridge.ack).toHaveBeenCalledWith(1);
  expect(native.current().pending).toBeNull();
  expect(
    vi.mocked(native.bridge.listen).mock.invocationCallOrder[0],
  ).toBeLessThan(
    vi.mocked(native.bridge.snapshot).mock.invocationCallOrder[0]!,
  );
  await transport.refresh();
  native.notify(1);
  await turn();
  expect(handoff).toHaveBeenCalledTimes(1);
});
it("keeps unaccepted startup bounded for explicit refresh and never equates ack with navigation", async () => {
  const native = broker();
  native.activate();
  let ready = false;
  const controller: unknown[] = [];
  const transport = createNativeNoteLinkIngress(native.bridge);
  await transport.start((value) => {
    if (!ready) return false;
    controller.push(value);
    return true;
  });
  expect(native.current().pending).not.toBeNull();
  expect(native.bridge.ack).not.toHaveBeenCalled();
  ready = true;
  await transport.refresh();
  expect(controller).toEqual([target]);
  expect(native.current().pending).toBeNull();
  await transport.refresh();
  expect(controller).toHaveLength(1);
});
it("retires semantically invalid values without disclosing identity or navigating", async () => {
  const native = broker();
  native.activate("orbyn-notes://note/v1/eyJ2IjoxfQ");
  const invalid = vi.fn(),
    handoff = vi.fn((_target: NoteTarget, _sequence: number) => true),
    transport = createNativeNoteLinkIngress(native.bridge);
  await transport.start(handoff, invalid);
  expect(invalid).toHaveBeenCalledExactlyOnceWith();
  expect(handoff).not.toHaveBeenCalled();
  expect(native.bridge.ack).toHaveBeenCalledWith(1);
});
it("ignores older snapshots once a newer sequence event has been observed", async () => {
  const native = broker();
  native.activate();
  const held = deferred<unknown>();
  vi.mocked(native.bridge.snapshot).mockReturnValueOnce(held.promise);
  const handoff = vi.fn((_target: NoteTarget, _sequence: number) => true),
    transport = createNativeNoteLinkIngress(native.bridge);
  const start = transport.start(handoff);
  await turn();
  native.activate();
  await turn();
  held.resolve({ sequence: 1, pending: { sequence: 1, uri } });
  await start;
  expect(handoff.mock.calls.map((call) => call[1])).toEqual([2]);
});
it("conditional old acknowledgment cannot erase a newer native request", async () => {
  const native = broker(),
    hold = deferred<void>(),
    real = vi.mocked(native.bridge.ack).getMockImplementation()!;
  let first = true;
  vi.mocked(native.bridge.ack).mockImplementation(async (value) => {
    if (first) {
      first = false;
      await hold.promise;
    }
    return real(value);
  });
  native.activate();
  const handoff = vi.fn((_target: NoteTarget, _sequence: number) => true),
    transport = createNativeNoteLinkIngress(native.bridge),
    start = transport.start(handoff);
  await turn();
  native.activate();
  await turn();
  hold.resolve();
  await start;
  expect(handoff.mock.calls.map((call) => call[1])).toEqual([1, 2]);
  expect(native.current().pending).toBeNull();
});
it("fences held snapshots at revocation and admits only a deliberately newer activation", async () => {
  const native = broker();
  native.activate();
  const held = deferred<unknown>();
  vi.mocked(native.bridge.snapshot).mockReturnValueOnce(held.promise);
  const handoff = vi.fn((_target: NoteTarget, _sequence: number) => true),
    transport = createNativeNoteLinkIngress(native.bridge),
    start = transport.start(handoff);
  await turn();
  await transport.retire();
  held.resolve({ sequence: 1, pending: { sequence: 1, uri } });
  await start;
  expect(handoff).not.toHaveBeenCalled();
  native.activate();
  await turn();
  expect(handoff).toHaveBeenCalledWith(target, 3);
});
it("pauses through every overlapping retirement and keeps the maximum out-of-order barrier watermark", async () => {
  const native = broker(),
    one = deferred<unknown>(),
    two = deferred<unknown>();
  vi.mocked(native.bridge.retire)
    .mockReturnValueOnce(one.promise)
    .mockReturnValueOnce(two.promise);
  const handoff = vi.fn((_target: NoteTarget, _sequence: number) => true),
    transport = createNativeNoteLinkIngress(native.bridge);
  await transport.start(handoff);
  const first = transport.retire(),
    second = transport.retire();
  native.activate();
  two.resolve({ sequence: 4 });
  await second;
  await transport.refresh();
  expect(handoff).not.toHaveBeenCalled();
  one.resolve({ sequence: 2 });
  await first;
  await turn();
  expect(handoff).not.toHaveBeenCalled();
  native.notify(3);
  await turn();
  expect(handoff).not.toHaveBeenCalled();
});
it("keeps failed retirement paused until explicit successful barrier retry", async () => {
  const native = broker();
  const handoff = vi.fn((_target: NoteTarget, _sequence: number) => true),
    transport = createNativeNoteLinkIngress(native.bridge);
  await transport.start(handoff);
  vi.mocked(native.bridge.retire).mockRejectedValueOnce(
    new Error("IPC unavailable"),
  );
  await expect(transport.retire()).rejects.toThrow();
  native.activate();
  await turn();
  expect(handoff).not.toHaveBeenCalled();
  await transport.retire();
  native.activate();
  await turn();
  expect(handoff).toHaveBeenCalledWith(target, 3);
});
it("keeps app watermark across stop/restart and treats a new sequence for the same URI as new intent", async () => {
  const native = broker();
  native.activate();
  const handoff = vi.fn((_target: NoteTarget, _sequence: number) => true),
    transport = createNativeNoteLinkIngress(native.bridge);
  await transport.start(handoff);
  await transport.stop();
  vi.mocked(native.bridge.snapshot).mockResolvedValueOnce({
    sequence: 1,
    pending: { sequence: 1, uri },
  });
  await transport.start(handoff);
  expect(handoff).toHaveBeenCalledTimes(1);
  native.activate();
  await turn();
  expect(handoff.mock.calls.map((call) => call[1])).toEqual([1, 3]);
});
it("start replacement with late listener cleanup never drops the original startup request", async () => {
  const native = broker();
  native.activate();
  const late = deferred<() => void>(),
    cleanup = vi.fn();
  vi.mocked(native.bridge.listen).mockReturnValueOnce(late.promise);
  const old = vi.fn((_target: NoteTarget, _sequence: number) => true),
    latest = vi.fn((_target: NoteTarget, _sequence: number) => true),
    transport = createNativeNoteLinkIngress(native.bridge);
  const first = transport.start(old);
  await transport.start(latest);
  late.resolve(cleanup);
  await first;
  expect(cleanup).toHaveBeenCalledOnce();
  expect(old).not.toHaveBeenCalled();
  expect(latest).toHaveBeenCalledWith(target, 1);
});
it("restart while old stop barrier/listener await does not permanently pause the latest start", async () => {
  const native = broker(),
    late = deferred<() => void>(),
    barrier = deferred<unknown>(),
    cleanup = vi.fn();
  vi.mocked(native.bridge.listen).mockReturnValueOnce(late.promise);
  vi.mocked(native.bridge.retire).mockReturnValueOnce(barrier.promise);
  const old = vi.fn((_target: NoteTarget, _sequence: number) => true),
    latest = vi.fn((_target: NoteTarget, _sequence: number) => true),
    transport = createNativeNoteLinkIngress(native.bridge),
    first = transport.start(old),
    stop = transport.stop();
  await transport.start(latest);
  late.resolve(cleanup);
  await first;
  native.activate();
  await turn();
  expect(latest).not.toHaveBeenCalled();
  barrier.resolve({ sequence: 2 });
  await stop;
  native.activate();
  native.activate();
  await turn();
  expect(latest).toHaveBeenCalledWith(target, 3);
  expect(old).not.toHaveBeenCalled();
  expect(cleanup).toHaveBeenCalledOnce();
});

it("reports background failures without raw payload and reconnect barrier clears poison", async () => {
  const native = broker(),
    error = vi.fn(),
    handoff = vi.fn((_target: NoteTarget, _sequence: number) => true),
    transport = createNativeNoteLinkIngress(native.bridge);
  await transport.start(handoff, undefined, error);
  vi.mocked(native.bridge.snapshot).mockRejectedValueOnce(
    new Error("synthetic IPC failure"),
  );
  native.activate();
  await turn();
  expect(error).toHaveBeenCalledExactlyOnceWith();
  expect(handoff).not.toHaveBeenCalled();
  vi.mocked(native.bridge.retire).mockRejectedValueOnce(
    new Error("retirement failure"),
  );
  await expect(transport.retire()).rejects.toThrow();
  native.activate();
  await turn();
  expect(handoff).not.toHaveBeenCalled();
  await transport.retire();
  await transport.start(handoff, undefined, error);
  native.activate();
  await turn();
  expect(handoff).toHaveBeenCalledTimes(1);
});

it("new activations re-notify a failed retirement without retrying or navigating", async () => {
  const native = broker(),
    error = vi.fn(),
    handoff = vi.fn((_target: NoteTarget, _sequence: number) => true),
    transport = createNativeNoteLinkIngress(native.bridge);
  await transport.start(handoff, undefined, error);
  vi.mocked(native.bridge.retire).mockRejectedValueOnce(
    new Error("failed barrier"),
  );
  await expect(transport.retire()).rejects.toThrow();
  vi.mocked(native.bridge.snapshot).mockClear();
  const first = native.activate();
  await turn();
  expect(error).toHaveBeenCalledTimes(1);
  native.notify(first);
  native.notify(first - 1);
  await turn();
  expect(error).toHaveBeenCalledTimes(1);
  native.activate();
  await turn();
  expect(error).toHaveBeenCalledTimes(2);
  expect(native.bridge.snapshot).not.toHaveBeenCalled();
  expect(handoff).not.toHaveBeenCalled();
});
it("held snapshot errors from retired generations cannot notify a newer owner", async () => {
  const native = broker(),
    held = deferred<unknown>(),
    error = vi.fn(),
    handoff = vi.fn((_target: NoteTarget, _sequence: number) => true),
    transport = createNativeNoteLinkIngress(native.bridge);
  await transport.start(handoff, undefined, error);
  vi.mocked(native.bridge.snapshot).mockReturnValueOnce(held.promise);
  native.activate();
  await transport.retire();
  held.reject(new Error("old failure"));
  await turn();
  expect(error).not.toHaveBeenCalled();
});
it("listener readiness gates snapshots during failed-start reconnect", async () => {
  const native = broker(),
    late = deferred<() => void>(),
    handoff = vi.fn((_target: NoteTarget, _sequence: number) => true),
    transport = createNativeNoteLinkIngress(native.bridge);
  vi.mocked(native.bridge.listen).mockRejectedValueOnce(
    new Error("no listener"),
  );
  await expect(transport.start(handoff)).rejects.toThrow();
  await transport.retire();
  native.activate();
  await turn();
  expect(handoff).not.toHaveBeenCalled();
  vi.mocked(native.bridge.listen).mockReturnValueOnce(late.promise);
  const restart = transport.start(handoff);
  await transport.refresh();
  expect(handoff).not.toHaveBeenCalled();
  late.resolve(() => {});
  await restart;
  expect(handoff).toHaveBeenCalledWith(target, 2);
});

it.each(["snapshot", "ack"])(
  "newer successful handoff suppresses a held old background %s failure",
  async (kind) => {
    const native = broker(),
      held = deferred<unknown>(),
      error = vi.fn(),
      handoff = vi.fn((_target: NoteTarget, _sequence: number) => true),
      transport = createNativeNoteLinkIngress(native.bridge);
    await transport.start(handoff, undefined, error);
    if (kind === "snapshot")
      vi.mocked(native.bridge.snapshot).mockReturnValueOnce(held.promise);
    else vi.mocked(native.bridge.ack).mockReturnValueOnce(held.promise);
    native.activate();
    await turn();
    native.activate();
    await turn();
    expect(handoff).toHaveBeenCalledWith(target, 2);
    held.reject(new Error("old background failure"));
    await turn();
    expect(error).not.toHaveBeenCalled();
  },
);
it.each(["snapshot", "ack"])(
  "newer activation fences a late initial-start %s rejection",
  async (kind) => {
    const native = broker(),
      held = deferred<unknown>(),
      error = vi.fn(),
      handoff = vi.fn((_target: NoteTarget, _sequence: number) => true),
      transport = createNativeNoteLinkIngress(native.bridge);
    native.activate();
    if (kind === "snapshot")
      vi.mocked(native.bridge.snapshot).mockReturnValueOnce(held.promise);
    else vi.mocked(native.bridge.ack).mockReturnValueOnce(held.promise);
    const start = transport.start(handoff, undefined, error);
    const outcome = start.then(
      () => "resolved",
      () => "rejected",
    );
    await turn();
    native.activate();
    await turn();
    expect(handoff).toHaveBeenCalledWith(target, 2);
    held.reject(new Error("old startup failure"));
    expect(await outcome).toBe("resolved");
    expect(error).not.toHaveBeenCalled();
  },
);

it.each(["snapshot", "ack"])(
  "still reports the genuine current background %s failure",
  async (kind) => {
    const native = broker(),
      error = vi.fn(),
      handoff = vi.fn((_target: NoteTarget, _sequence: number) => true),
      transport = createNativeNoteLinkIngress(native.bridge);
    await transport.start(handoff, undefined, error);
    if (kind === "snapshot")
      vi.mocked(native.bridge.snapshot).mockRejectedValueOnce(
        new Error("current failure"),
      );
    else
      vi.mocked(native.bridge.ack).mockRejectedValueOnce(
        new Error("current failure"),
      );
    native.activate();
    await turn();
    expect(error).toHaveBeenCalledExactlyOnceWith();
    expect(handoff).toHaveBeenCalledTimes(kind === "ack" ? 1 : 0);
  },
);
it.each(["snapshot", "ack"])(
  "still rejects a genuine current startup %s failure",
  async (kind) => {
    const native = broker(),
      transport = createNativeNoteLinkIngress(native.bridge);
    native.activate();
    if (kind === "snapshot")
      vi.mocked(native.bridge.snapshot).mockRejectedValueOnce(
        new Error("current startup failure"),
      );
    else
      vi.mocked(native.bridge.ack).mockRejectedValueOnce(
        new Error("current startup failure"),
      );
    await expect(transport.start(() => true)).rejects.toThrow(
      "current startup failure",
    );
  },
);

it("native bridge subscribes explicitly to the same main WebviewWindow target as Rust", async () => {
  const unlisten = vi.fn();
  nativeWiring.listen.mockResolvedValue(unlisten);
  nativeWiring.invoke.mockImplementation(async (command: string) =>
    command === "note_link_retire"
      ? { sequence: 1 }
      : { sequence: 0, pending: null },
  );
  await nativeNoteLinkIngress.start(() => true);
  expect(nativeWiring.listen).toHaveBeenCalledWith(
    "notes-reference-pending",
    expect.any(Function),
    { target: { kind: "WebviewWindow", label: "main" } },
  );
  expect(nativeWiring.invoke).toHaveBeenCalledWith("note_link_snapshot");
  await nativeNoteLinkIngress.stop();
  expect(unlisten).toHaveBeenCalledOnce();
});
