// @vitest-environment node
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { IDBFactory } from "fake-indexeddb";
import {
  initSync,
  DeviceKeys,
  SyncEngine,
} from "../../src/generated/wasm/orbyn_wasm.js";
import { openLocalSession, LOCAL_LIBRARY_KEY } from "../../src/data/local";
import { openNotesStore } from "../../src/data";
import {
  mutateRecord,
  readRecord,
  wrappingSecret,
  type DeviceRecord,
} from "../../src/data/database";
import { lock } from "../../src/account/session";
import { LIBRARY_ZONE } from "../../src/library/storage";
import type { NotesLibraryStore } from "../../src/library/contracts";

const handles: NotesLibraryStore[] = [];
const input = {
  title: "Synthetic local note",
  tags: ["trip"],
  document: { type: "doc" as const, content: [] },
};
beforeAll(async () => {
  initSync({
    module: await readFile(
      new URL("../../src/generated/wasm/orbyn_wasm_bg.wasm", import.meta.url),
    ),
  });
});
beforeEach(() => {
  lock();
  vi.stubGlobal("indexedDB", new IDBFactory());
});
afterEach(() => {
  handles.splice(0).forEach((store) => store.close());
  lock();
  vi.restoreAllMocks();
});

// Reproduce the persisted extension written by the tag-management build, without
// copying any real user workspace or weakening the production writer's checks.
async function seed(
  extension: Record<string, unknown>,
  kind = "tag-reorder",
  args = "[]",
  version = 2,
) {
  const identity = await openLocalSession();
  const store = await openNotesStore(identity);
  handles.push(store);
  const note = await store.create(input);
  store.close();
  const record = (await readRecord<DeviceRecord>(
    "devices",
    LOCAL_LIBRARY_KEY,
  ))!;
  const secret = await wrappingSecret(record.wrapKey);
  const keys = DeviceKeys.import(record.sealedKeys, secret);
  const engine = SyncEngine.restore(keys, record.snapshot!, secret, Date.now());
  try {
    const raw = JSON.parse(engine.record(LIBRARY_ZONE, "workspace")!);
    const metadata = raw.fields.library.value;
    if (version === 3) {
      metadata.version = 3;
      metadata.noteLinks = [];
    }
    Object.assign(metadata.tags[0], extension);
    metadata.receipts.push({
      id: crypto.randomUUID(),
      epoch: metadata.epoch,
      committedAt: new Date().toISOString(),
      libraryRevision: metadata.revision,
      kind,
      arguments: args,
      result: { type: "metadata" },
    });
    engine.stage(
      LIBRARY_ZONE,
      "notes_library_metadata",
      "workspace",
      JSON.stringify({
        library: {
          value: metadata,
          stamp: JSON.parse(engine.tick(Date.now())),
        },
      }),
    );
    await mutateRecord<DeviceRecord>(
      "devices",
      LOCAL_LIBRARY_KEY,
      (current) => ({ ...current!, snapshot: engine.snapshot(secret) }),
    );
  } finally {
    engine.free();
    keys.free();
    secret.fill(0);
  }
  lock();
  return note;
}

async function snapshot(store: NotesLibraryStore) {
  const result = await store.library.read();
  if (result.mode !== "ready") throw new Error("Expected a writable library");
  return result.snapshot;
}

it.each([2, 3])(
  "reopens v%i ordered/pinned local tags without an account and preserves them after editing",
  async (version) => {
    const network = vi.spyOn(globalThis, "fetch");
    const note = await seed(
      { order: 2, pinned: true },
      "tag-reorder",
      "[]",
      version,
    );
    const store = await openNotesStore(await openLocalSession());
    handles.push(store);
    expect(await store.get(note.id)).toEqual(note);
    expect((await snapshot(store)).tags[0]).toMatchObject({
      order: 2,
      pinned: true,
    });
    await store.update(
      note.id,
      { ...input, title: "Edited locally" },
      note.revision,
    );
    store.close();
    lock();
    const reopened = await openNotesStore(await openLocalSession());
    handles.push(reopened);
    expect((await reopened.get(note.id))?.title).toBe("Edited locally");
    expect((await snapshot(reopened)).tags[0]).toMatchObject({
      order: 2,
      pinned: true,
    });
    expect(network).not.toHaveBeenCalled();
  },
);

it("accepts bounded reorder receipts larger than ordinary mutation receipts", async () => {
  await seed(
    { order: 0 },
    "tag-reorder",
    JSON.stringify(Array.from({ length: 60 }, () => crypto.randomUUID())),
  );
  const store = await openNotesStore(await openLocalSession());
  handles.push(store);
  expect((await snapshot(store)).tags[0]).toMatchObject({ order: 0 });
});

it("accepts tag pin receipts", async () => {
  await seed({ pinned: false }, "tag-pin");
  const store = await openNotesStore(await openLocalSession());
  handles.push(store);
  expect((await snapshot(store)).tags[0]).toMatchObject({ pinned: false });
});

it.each([
  ["tag-pin", JSON.stringify("x".repeat(2048))],
  ["tag-reorder", JSON.stringify("x".repeat(402048))],
  ["unknown-action", "[]"],
])(
  "rejects unsupported or oversized %s receipts without rewriting data",
  async (kind, args) => {
    await seed({}, kind, args);
    const before = (await readRecord<DeviceRecord>(
      "devices",
      LOCAL_LIBRARY_KEY,
    ))!;
    await expect(openNotesStore(await openLocalSession())).rejects.toThrow(
      "library_invalid",
    );
    const after = (await readRecord<DeviceRecord>(
      "devices",
      LOCAL_LIBRARY_KEY,
    ))!;
    expect(after.snapshot).toEqual(before.snapshot);
    expect(after.generation).toBe(before.generation);
  },
);

it.each([
  { order: -1 },
  { order: 0.5 },
  { order: "0" },
  { order: Number.MAX_SAFE_INTEGER + 1 },
  { pinned: "true" },
  { unexpected: true },
])(
  "still rejects invalid tag metadata without changing the saved snapshot: %j",
  async (extension) => {
    await seed(extension);
    const before = (await readRecord<DeviceRecord>(
      "devices",
      LOCAL_LIBRARY_KEY,
    ))!;
    await expect(openNotesStore(await openLocalSession())).rejects.toThrow(
      "library_invalid",
    );
    const after = (await readRecord<DeviceRecord>(
      "devices",
      LOCAL_LIBRARY_KEY,
    ))!;
    expect(after.snapshot).toEqual(before.snapshot);
    expect(after.generation).toBe(before.generation);
  },
);
