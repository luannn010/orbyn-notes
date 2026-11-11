// @vitest-environment node
import { beforeAll, afterEach, it, expect, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { IDBFactory } from "fake-indexeddb";
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
import { emptyStudy } from "../../src/collections/validation";
import type {
  CollectionsState,
  CollectionsStore,
} from "../../src/collections/contracts";

const identity = {
  accountId: "11111111-1111-4111-8111-111111111111",
  deviceId: "22222222-2222-4222-8222-222222222222",
  email: "linear@example.test",
  deviceState: "trusted" as const,
};
let store: CollectionsStore | undefined;
beforeAll(async () => {
  initSync({
    module: await readFile(
      new URL("../../src/generated/wasm/orbyn_wasm_bg.wasm", import.meta.url),
    ),
  });
});
afterEach(() => {
  store?.close();
  store = undefined;
  vi.restoreAllMocks();
  lock();
});
it("keeps source admission linear at all 10000 anchored entries and still rejects forged birth", async () => {
  lock();
  vi.stubGlobal("indexedDB", new IDBFactory());
  establish(identity);
  const at = new Date().toISOString(),
    deckId = crypto.randomUUID(),
    libraryEpoch = crypto.randomUUID();
  const state: CollectionsState = {
    version: 3,
    epoch: crypto.randomUUID(),
    revision: 1,
    study: emptyStudy("UTC"),
    journal: null,
    clips: { items: [], receipts: [] },
  };
  state.study.decks.push({
    id: deckId,
    title: "Large real source profile",
    revision: 1,
    createdAt: at,
    updatedAt: at,
  });
  for (let index = 0; index < 10000; index++) {
    const entryId = crypto.randomUUID();
    state.study.entries.push({
      id: entryId,
      deckId,
      revision: 1,
      type: "basic",
      front: "Question",
      back: "Answer",
      tags: [],
      source: {
        version: 2,
        noteId: "actual-source-profile",
        noteRevision: 1,
        quote: "Actual source",
        libraryEpoch,
        anchorId: crypto.randomUUID(),
      },
    });
    state.study.cards.push({
      id: crypto.randomUUID(),
      entryId,
      revision: 1,
      key: "basic:forward",
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
  const wrapKey = await newWrappingKey(),
    secret = await wrappingSecret(wrapKey),
    keys = DeviceKeys.create(),
    engine = SyncEngine.create(keys, identity.accountId, identity.deviceId);
  try {
    engine.createZoneKey("notes-collections-v1");
    engine.stage(
      "notes-collections-v1",
      "notes_collections",
      "workspace",
      JSON.stringify({
        collections: {
          value: state,
          stamp: JSON.parse(engine.tick(Date.now())),
        },
      }),
    );
    await mutateRecord<DeviceRecord>("devices", identity.email, () => ({
      ...identity,
      wrapKey,
      sealedKeys: keys.export(secret),
      snapshot: engine.snapshot(secret),
      generation: 1,
      verifiedTrust: true,
    }));
  } finally {
    engine.free();
    keys.free();
    secret.fill(0);
  }
  store = await openCollectionsStore(identity);
  const before = await store.read(),
    originalFind = Array.prototype.find;
  let predicateComparisons = 0;
  const finding = vi
    .spyOn(Array.prototype, "find")
    .mockImplementation(function (this: unknown[], predicate, thisArg) {
      const sourceEntries =
        this.length === 10000 &&
        (this[0] as { type?: unknown })?.type === "basic";
      if (!sourceEntries) return originalFind.call(this, predicate, thisArg);
      return originalFind.call(this, (value, index, array) => {
        predicateComparisons++;
        return predicate.call(thisArg, value, index, array);
      });
    });
  let updated: CollectionsState;
  try {
    updated = await store.update(before, (current) => ({
      ...current,
      study: {
        ...current.study,
        preferences: {
          ...current.study.preferences,
          showStreak: !current.study.preferences.showStreak,
        },
      },
    }));
  } finally {
    finding.mockRestore();
  }
  expect(predicateComparisons).toBeLessThanOrEqual(20000);
  expect(updated!.study.entries).toHaveLength(10000);
  expect(updated!.study.entries[9999]!.source).toEqual(
    before.study.entries[9999]!.source,
  );
  const stored = (await readRecord<DeviceRecord>("devices", identity.email))!;
  await expect(
    store.update(updated!, (current) => {
      current.study.entries[9999]!.source!.noteRevision++;
      return current;
    }),
  ).rejects.toThrow("Anchored source birth");
  const after = (await readRecord<DeviceRecord>("devices", identity.email))!;
  expect(after.snapshot).toEqual(stored.snapshot);
  expect(after.generation).toBe(stored.generation);
}, 30000);
