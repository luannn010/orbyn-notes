// @vitest-environment node
import { beforeAll, beforeEach, afterEach, it, expect, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import {
  initSync,
  DeviceKeys,
  SyncEngine,
} from "../../src/generated/wasm/orbyn_wasm.js";
import { establish, lock } from "../../src/account/session";
import {
  newWrappingKey,
  wrappingSecret,
  mutateRecord,
  readRecord,
} from "../../src/data/database";
import type { DeviceRecord } from "../../src/data/database";
import { openCollectionsStore } from "../../src/collections/store";
import type {
  CollectionsStore,
  LegacyCollectionsState,
} from "../../src/collections/contracts";
import { createClipsStore } from "../../src/clips/store";
import type { ClipsStore, ClipActionInput } from "../../src/clips/contracts";
import {
  ClipConflictError,
  ClipDuplicateError,
} from "../../src/clips/contracts";
import {
  validateClipAction,
  validateClipState,
  CLIP_LIMITS,
} from "../../src/clips/validation";
import { exportClipsFiles } from "../../src/clips/transfer";
import {
  emptyStudy,
  validateCollections,
  validateLegacyCollections,
  normalizeCollections,
  LEGACY_COLLECTIONS_BYTES,
  EMPTY_CLIPS_OVERHEAD,
  COLLECTIONS_LIMITS,
} from "../../src/collections/validation";
import { openNotesStore } from "../../src/data";

const identity = {
  accountId: "11111111-1111-4111-8111-111111111111",
  deviceId: "22222222-2222-4222-8222-222222222222",
  email: "clips@example.test",
  deviceState: "trusted" as const,
};
const handles = new Set<{ close(): void }>();
const create: ClipActionInput = {
  kind: "create",
  url: "https://Example.test/path?q=1#fragment",
  title: "  Actual clip  ",
  text: "  pasted <script>text</script>\n",
  readLater: false,
  allowDuplicate: false,
};
beforeAll(async () => {
  initSync({
    module: await readFile(
      new URL("../../src/generated/wasm/orbyn_wasm_bg.wasm", import.meta.url),
    ),
  });
});
beforeEach(async () => {
  lock();
  vi.stubGlobal("indexedDB", new IDBFactory());
  const wrapKey = await newWrappingKey(),
    secret = await wrappingSecret(wrapKey),
    keys = DeviceKeys.create();
  try {
    await mutateRecord<DeviceRecord>("devices", identity.email, () => ({
      ...identity,
      wrapKey,
      sealedKeys: keys.export(secret),
      generation: 0,
      verifiedTrust: true,
    }));
  } finally {
    keys.free();
    secret.fill(0);
  }
  establish(identity);
});
afterEach(() => {
  for (const handle of handles) handle.close();
  handles.clear();
  vi.restoreAllMocks();
  vi.useRealTimers();
  lock();
});
async function open() {
  const collections = await openCollectionsStore(identity);
  handles.add(collections);
  const clips = createClipsStore(collections);
  handles.add(clips);
  return { collections, clips };
}
async function act(clips: ClipsStore, input: ClipActionInput) {
  return clips.commit(await clips.prepare(await clips.read(), input));
}
async function rawPayload() {
  const record = (await readRecord<DeviceRecord>("devices", identity.email))!,
    secret = await wrappingSecret(record.wrapKey),
    keys = DeviceKeys.import(record.sealedKeys, secret);
  const engine = SyncEngine.restore(keys, record.snapshot!, secret, Date.now());
  try {
    return JSON.parse(engine.record("notes-collections-v1", "workspace")!)
      .fields.collections.value;
  } finally {
    engine.free();
    keys.free();
    secret.fill(0);
  }
}
async function seed(value: unknown, owner = "notes_collections") {
  const record = (await readRecord<DeviceRecord>("devices", identity.email))!,
    secret = await wrappingSecret(record.wrapKey),
    keys = DeviceKeys.import(record.sealedKeys, secret);
  const engine = SyncEngine.create(keys, identity.accountId, identity.deviceId);
  try {
    engine.createZoneKey("notes-collections-v1");
    engine.stage(
      "notes-collections-v1",
      owner,
      "workspace",
      JSON.stringify({
        collections: { value, stamp: JSON.parse(engine.tick(Date.now())) },
      }),
    );
    const snapshot = engine.snapshot(secret);
    await mutateRecord<DeviceRecord>("devices", identity.email, (current) => ({
      ...current!,
      snapshot,
      generation: current!.generation + 1,
    }));
  } finally {
    engine.free();
    keys.free();
    secret.fill(0);
  }
}
function legacy(): LegacyCollectionsState {
  return {
    version: 1,
    epoch: crypto.randomUUID(),
    revision: 9,
    study: emptyStudy("UTC"),
    journal: {
      version: 1,
      kdf: {
        name: "PBKDF2-SHA256",
        iterations: 600000,
        salt: btoa("s".repeat(16)),
      },
      iv: btoa("i".repeat(12)),
      ciphertext: btoa("c".repeat(16)),
    },
  };
}

it("saves real pasted text offline, reopens, mutates desired flags and exports complete actual data", async () => {
  vi.stubGlobal("navigator", { onLine: false });
  const { clips } = await open();
  const result = await act(clips, create),
    item = result.snapshot.clips.items[0]!;
  expect(item).toMatchObject({
    originalUrl: create.url,
    canonicalUrl: "https://example.test/path?q=1",
    title: "Actual clip",
    text: create.text,
    revision: 1,
  });
  const reopened = (await open()).clips;
  expect((await reopened.read()).clips.items).toEqual([item]);
  const read = await act(reopened, {
    kind: "set-read",
    clipId: item.id,
    targetRevision: 1,
    read: true,
  });
  const later = await act(reopened, {
    kind: "set-read-later",
    clipId: item.id,
    targetRevision: 2,
    readLater: true,
  });
  const archived = await act(reopened, {
    kind: "set-archived",
    clipId: item.id,
    targetRevision: 3,
    archived: true,
  });
  expect(read.snapshot.clips.items[0]!.readAt).not.toBeNull();
  expect(later.snapshot.clips.items[0]!.readLater).toBe(true);
  expect(archived.snapshot.clips.items[0]!.archivedAt).not.toBeNull();
  const unchanged = await act(reopened, {
    kind: "set-archived",
    clipId: item.id,
    targetRevision: 4,
    archived: true,
  });
  expect(unchanged.changed).toBe(false);
  expect(unchanged.receipt.changed).toBe(false);
  expect(unchanged.snapshot.clips.items[0]!.revision).toBe(4);
  expect(unchanged.snapshot.revision).toBe(archived.snapshot.revision + 1);
  const files = exportClipsFiles(unchanged.snapshot.clips);
  expect(JSON.parse(files[0]!.content)).toEqual({
    version: 1,
    ...unchanged.snapshot.clips,
  });
  expect(
    files
      .find((file) => file.filename.endsWith(item.id + ".txt"))!
      .content.endsWith(create.text),
  ).toBe(true);
  expect(
    files.find((file) => file.filename === "README.txt")!.content,
  ).toContain("no automatic import");
  expect(exportClipsFiles({ items: [], receipts: [] })).toEqual([]);
});
it("reconciles an unknown committed result and concurrent exact retries without duplicate writes", async () => {
  const { clips, collections } = await open(),
    intent = await clips.prepare(await clips.read(), create);
  const update = collections.update.bind(collections);
  vi.spyOn(collections, "update").mockImplementationOnce(async (...args) => {
    await update(...args);
    throw new Error("Synthetic unknown result");
  });
  await expect(clips.commit(intent)).rejects.toThrow("unknown result");
  const before = (await readRecord<DeviceRecord>("devices", identity.email))!;
  const [a, b] = await Promise.all([
    clips.commit(intent),
    clips.commit(intent),
  ]);
  expect(a.replayed && b.replayed).toBe(true);
  expect(a.receipt).toEqual(b.receipt);
  expect((await clips.read()).clips.items).toHaveLength(1);
  const after = (await readRecord<DeviceRecord>("devices", identity.email))!;
  expect(after.snapshot).toEqual(before.snapshot);
  expect(after.generation).toBe(before.generation);
});
it("checks canonical duplicates including archived clips, requires deliberate new intent, and rejects races", async () => {
  const { clips } = await open(),
    expected = await clips.read();
  const a = await clips.prepare(expected, create),
    b = await clips.prepare(expected, create);
  const saved = await clips.commit(a),
    item = saved.snapshot.clips.items[0]!;
  await expect(clips.commit(b)).rejects.toBeInstanceOf(ClipConflictError);
  await act(clips, {
    kind: "set-archived",
    clipId: item.id,
    targetRevision: 1,
    archived: true,
  });
  const duplicate = await clips.prepare(await clips.read(), {
    ...create,
    url: "https://example.test/path?q=1#different",
  });
  await expect(clips.commit(duplicate)).rejects.toBeInstanceOf(
    ClipDuplicateError,
  );
  const again = await act(clips, { ...create, allowDuplicate: true });
  expect(again.snapshot.clips.items).toHaveLength(2);
  expect(again.snapshot.clips.items[1]!.id).not.toBe(item.id);
});
it("uses admission time for Undo after slow hashing, never resets it on replay, and refuses stale/expired undo", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-11T10:00:00Z"));
  const { clips } = await open();
  const intent = await clips.prepare(await clips.read(), create);
  vi.setSystemTime(Date.now() + 20000);
  const saved = await clips.commit(intent);
  expect(saved.receipt.at).toBe(new Date().toISOString());
  expect(saved.snapshot.clips.items[0]!.createdAt).not.toBe(saved.receipt.at);
  const replay = await clips.commit(intent);
  expect(replay.receipt.at).toBe(saved.receipt.at);
  const undo = await clips.prepare(await clips.read(), {
    kind: "undo-create",
    receiptOperationId: saved.receipt.operationId,
    targetRevision: 1,
  });
  vi.setSystemTime(Date.now() + 5001);
  await expect(clips.commit(undo)).rejects.toThrow("clip_undo_unavailable");
  const fresh = await act(clips, {
    ...create,
    url: "https://example.test/new",
  });
  const undone = await act(clips, {
    kind: "undo-create",
    receiptOperationId: fresh.receipt.operationId,
    targetRevision: 1,
  });
  expect(undone.snapshot.clips.items).toHaveLength(1);
  expect(validateClipState(undone.snapshot.clips)).toEqual(
    undone.snapshot.clips,
  );
});
it("keeps edited clips when old Undo is attempted and preserves exact snapshot on quota failure", async () => {
  const { clips } = await open(),
    saved = await act(clips, create),
    item = saved.snapshot.clips.items[0]!;
  await act(clips, {
    kind: "set-read",
    clipId: item.id,
    targetRevision: 1,
    read: true,
  });
  await expect(
    act(clips, {
      kind: "undo-create",
      receiptOperationId: saved.receipt.operationId,
      targetRevision: 1,
    }),
  ).rejects.toThrow("clip_stale");
  const intent = await clips.prepare(await clips.read(), {
    ...create,
    url: "https://example.test/quota",
  });
  const before = (await readRecord<DeviceRecord>("devices", identity.email))!;
  const put = vi
    .spyOn(IDBObjectStore.prototype, "put")
    .mockImplementationOnce(() => {
      throw new DOMException("Synthetic clip quota", "QuotaExceededError");
    });
  await expect(clips.commit(intent)).rejects.toThrow("clip quota");
  put.mockRestore();
  const after = (await readRecord<DeviceRecord>("devices", identity.email))!;
  expect(after.snapshot).toEqual(before.snapshot);
  expect(after.generation).toBe(before.generation);
  expect((await clips.commit(intent)).snapshot.clips.items).toHaveLength(2);
});
it.each(["lock", "erase", "close"] as const)(
  "revokes hash work and held intent on %s",
  async (reason) => {
    const { clips } = await open(),
      held = await clips.prepare(await clips.read(), create);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const digest = crypto.subtle.digest.bind(crypto.subtle);
    const hashing = vi
      .spyOn(crypto.subtle, "digest")
      .mockImplementationOnce(async (...args) => {
        await gate;
        return digest(...args);
      });
    const pending = clips.prepare(await clips.read(), {
      ...create,
      url: "https://example.test/delayed",
    });
    await vi.waitFor(() => expect(hashing).toHaveBeenCalled());
    const invalidation = vi.fn();
    clips.onInvalidate(invalidation);
    if (reason === "lock") establish(identity);
    else if (reason === "close") clips.close();
    else {
      const notes = await openNotesStore(identity);
      handles.add(notes);
      await notes.erase();
      await expect(clips.read()).rejects.toThrow("clip_intent_revoked");
    }
    release();
    await expect(pending).rejects.toThrow("clip_intent_revoked");
    await expect(clips.commit(held)).rejects.toThrow("clip_intent_revoked");
    expect(invalidation).toHaveBeenCalledWith(
      reason === "erase" ? "epoch" : "closed",
    );
  },
);
it("captures input before awaits and fences commits awaiting wrapping crypto after facade close", async () => {
  const { clips } = await open(),
    input = { ...create },
    pending = clips.prepare(await clips.read(), input);
  input.url = "javascript:changed";
  const intent = await pending;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const sign = crypto.subtle.sign.bind(crypto.subtle);
  vi.spyOn(crypto.subtle, "sign").mockImplementationOnce(async (...args) => {
    await gate;
    return sign(...args);
  });
  const committing = clips.commit(intent);
  clips.close();
  release();
  await expect(committing).rejects.toThrow("clip_intent_revoked");
  expect((await (await open()).clips.read()).clips.items).toEqual([]);
});
it("fences an atomic commit delayed across whole-workspace erase", async () => {
  const { clips } = await open(),
    intent = await clips.prepare(await clips.read(), create);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const sign = crypto.subtle.sign.bind(crypto.subtle);
  // Commit's first read completes, then its writer's wrapping crypto is paused.
  const signing = vi
    .spyOn(crypto.subtle, "sign")
    .mockImplementationOnce(sign)
    .mockImplementationOnce(async (...args) => {
      await gate;
      return sign(...args);
    });
  const committing = clips.commit(intent);
  await vi.waitFor(() => expect(signing).toHaveBeenCalledTimes(2));
  const notes = await openNotesStore(identity);
  handles.add(notes);
  await notes.erase();
  release();
  await expect(committing).rejects.toThrow();
  expect((await (await open()).clips.read()).clips.items).toEqual([]);
  await expect(clips.commit(intent)).rejects.toThrow("clip_intent_revoked");
});
it.each([
  "javascript:alert(1)",
  "mailto:a@example.test",
  "https://user:pass@example.test",
  "https://@example.test",
  "https:///example.test",
  "https://example.test\\path",
  "https://example.test/has space",
  "https://example.test/\n",
  "file:///tmp/a",
])("rejects unsafe URL %s", (url) => {
  expect(() => validateClipAction({ ...create, url })).toThrow("clip_invalid");
});
it("validates exact shapes, canonical URLs, text/title bounds and null text normalization", () => {
  expect(
    validateClipAction({ ...create, title: "  ", text: " \n" }),
  ).toMatchObject({ title: "example.test", text: "" });
  for (const value of [
    { ...create, unknown: true },
    { ...create, title: "x".repeat(301) },
    { ...create, text: "x".repeat(100001) },
    { ...create, url: "https://example.test/" + "x".repeat(8192) },
  ])
    expect(() => validateClipAction(value)).toThrow();
  expect(
    validateClipAction({
      ...create,
      url: "https://example.test/path@name?q=@value",
    }),
  ).toMatchObject({ url: "https://example.test/path@name?q=@value" });
});
it("bounds entities, receipts and total text, rejects malformed persisted data, and retains no-op receipt semantics", async () => {
  const { clips } = await open(),
    saved = await act(clips, create),
    item = saved.snapshot.clips.items[0]!,
    receipt = saved.receipt;
  for (const bad of [
    { ...saved.snapshot.clips, extra: true },
    {
      items: [{ ...item, canonicalUrl: item.canonicalUrl + "#bad" }],
      receipts: [],
    },
    { items: [{ ...item, text: " " }], receipts: [] },
    { items: [{ ...item, revision: 0 }], receipts: [] },
    { items: [{ ...item, readLater: "yes" }], receipts: [] },
    { items: [item, item], receipts: [] },
    { items: [item], receipts: [receipt, receipt] },
    { items: [item], receipts: [{ ...receipt, digest: "wrong" }] },
    { items: [item], receipts: [{ ...receipt, kind: "undo-create" }] },
    { items: Array.from({ length: 5001 }, () => item), receipts: [] },
    { items: [], receipts: Array.from({ length: 501 }, () => receipt) },
    {
      items: Array.from({ length: 126 }, () => ({
        ...item,
        id: crypto.randomUUID(),
        text: "x".repeat(100000),
      })),
      receipts: [],
    },
  ])
    expect(() => validateClipState(bad)).toThrow();
});
it("does not overwrite after a receipt is pruned or its identity/digest was reused", async () => {
  const { clips, collections } = await open(),
    intent = await clips.prepare(await clips.read(), create);
  const saved = await clips.commit(intent);
  await collections.update(saved.snapshot, (current) => ({
    ...current,
    clips: {
      ...current.clips,
      receipts: [{ ...current.clips.receipts[0]!, digest: "f".repeat(64) }],
    },
  }));
  await expect(clips.commit(intent)).rejects.toThrow("clip_operation_reused");
  await collections.update(await collections.read(), (current) => ({
    ...current,
    clips: { ...current.clips, receipts: [] },
  }));
  await expect(clips.commit(intent)).rejects.toBeInstanceOf(ClipConflictError);
  expect((await clips.read()).clips.items).toHaveLength(1);
});
it("isolates observer failures and closing the facade leaves the collections owner usable", async () => {
  const { clips, collections } = await open();
  clips.subscribe(() => {
    throw new Error("Synthetic observer");
  });
  await act(clips, create);
  clips.close();
  expect((await collections.read()).clips.items).toHaveLength(1);
  await collections.update(await collections.read(), (state) => state);
});
it("normalizes fully validated v1 without rewriting and first v2 write preserves Study/Journal", async () => {
  const old = legacy();
  await seed(old);
  const before = (await readRecord<DeviceRecord>("devices", identity.email))!;
  const put = vi.spyOn(IDBObjectStore.prototype, "put"),
    { clips } = await open();
  const current = await clips.read();
  expect(put).not.toHaveBeenCalled();
  put.mockRestore();
  expect(current.clips).toEqual({ items: [], receipts: [] });
  expect((await rawPayload()).version).toBe(1);
  expect(
    (await readRecord<DeviceRecord>("devices", identity.email))!.snapshot,
  ).toEqual(before.snapshot);
  await act(clips, create);
  const persisted = await rawPayload();
  expect(persisted.version).toBe(3);
  expect(persisted.study).toEqual(old.study);
  expect(persisted.journal).toEqual(old.journal);
  expect(() => validateLegacyCollections(persisted)).toThrow(
    "collections_invalid",
  );
  expect(() => validateCollections(old)).toThrow("collections_invalid");
});
it.each(["corrupt", "future", "foreign"] as const)(
  "rejects %s legacy payload without rewriting",
  async (kind) => {
    const old = legacy();
    await seed(
      kind === "future"
        ? { ...old, version: 4 }
        : kind === "corrupt"
          ? { ...old, extra: "bad" }
          : old,
      kind === "foreign" ? "foreign_owner" : "notes_collections",
    );
    const before = (await readRecord<DeviceRecord>("devices", identity.email))!;
    await expect(open()).rejects.toThrow("collections_invalid");
    const after = (await readRecord<DeviceRecord>("devices", identity.email))!;
    expect(after.snapshot).toEqual(before.snapshot);
    expect(after.generation).toBe(before.generation);
  },
);

it("reads exact-cap legacy data but atomically rejects nonempty Clips and revision digit growth beyond exact v2 overhead", async () => {
  const old = legacy(),
    deckId = crypto.randomUUID(),
    at = new Date().toISOString();
  old.study.decks.push({
    id: deckId,
    title: "Boundary fixture",
    createdAt: at,
    updatedAt: at,
    revision: 1,
  });
  for (let i = 0; i < 170; i++) {
    const entryId = crypto.randomUUID();
    old.study.entries.push({
      id: entryId,
      deckId,
      tags: [],
      source: null,
      revision: 1,
      type: "basic",
      front: "x",
      back: "x",
    });
    old.study.cards.push({
      id: crypto.randomUUID(),
      entryId,
      key: "basic:forward",
      revision: 1,
      schedule: {
        version: 1,
        state: "new",
        due: at,
        intervalDays: 0,
        ease: 2.5,
        repetitions: 0,
        lapses: 0,
        lastReviewedAt: null,
      },
    });
  }
  let remaining =
    LEGACY_COLLECTIONS_BYTES -
    new TextEncoder().encode(JSON.stringify(old)).byteLength;
  for (const entry of old.study.entries) {
    if (entry.type !== "basic") throw new Error("fixture variant");
    for (const key of ["front", "back"] as const) {
      const add = Math.min(99999, remaining);
      entry[key] += "x".repeat(add);
      remaining -= add;
    }
  }
  expect(remaining).toBe(0);
  expect(new TextEncoder().encode(JSON.stringify(old)).byteLength).toBe(
    LEGACY_COLLECTIONS_BYTES,
  );
  const normalized = normalizeCollections(old);
  expect(new TextEncoder().encode(JSON.stringify(normalized)).byteLength).toBe(
    LEGACY_COLLECTIONS_BYTES + EMPTY_CLIPS_OVERHEAD,
  );
  expect(COLLECTIONS_LIMITS.serializedBytes).toBe(
    LEGACY_COLLECTIONS_BYTES + EMPTY_CLIPS_OVERHEAD,
  );
  await seed(old);
  const before = (await readRecord<DeviceRecord>("devices", identity.email))!;
  const { clips, collections } = await open(),
    current = await collections.read();
  expect(current.study.entries).toHaveLength(170);
  expect(exportClipsFiles((await clips.read()).clips)).toEqual([]);
  await expect(act(clips, create)).rejects.toThrow("collections_invalid");
  // A receipt-free no-op still increments the global revision from9 to10;
  // that one extra decimal byte must not bypass the strict writer cap.
  await expect(collections.update(current, (state) => state)).rejects.toThrow(
    "collections_invalid",
  );
  const after = (await readRecord<DeviceRecord>("devices", identity.email))!;
  expect(after.snapshot).toEqual(before.snapshot);
  expect(after.generation).toBe(before.generation);
}, 30000);
