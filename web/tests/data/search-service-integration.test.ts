// @vitest-environment node
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { IDBFactory } from "fake-indexeddb";
import {
  initSync,
  DeviceKeys,
  SyncEngine,
} from "../../src/generated/wasm/orbyn_wasm.js";
import {
  newWrappingKey,
  wrappingSecret,
  mutateRecord,
  type DeviceRecord,
} from "../../src/data/database";
import { establish, lock } from "../../src/account/session";
import { openNotesStore } from "../../src/data";
import { openCollectionsStore } from "../../src/collections/store";
import { createDeck, saveEntry } from "../../src/study/model";
import { createLocalSearchService } from "../../src/search/service";
import type { SearchState } from "../../src/search/results";

const identity = {
  accountId: "31111111-1111-4111-8111-111111111111",
  deviceId: "32222222-2222-4222-8222-222222222222",
  email: "search-service@example.test",
  deviceState: "trusted" as const,
};
const handles = new Set<{ close(): void }>();
beforeAll(async () =>
  initSync({
    module: await readFile(
      new URL("../../src/generated/wasm/orbyn_wasm_bg.wasm", import.meta.url),
    ),
  }),
);
afterEach(() => {
  for (const handle of handles) handle.close();
  handles.clear();
  lock();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const ready = (state: SearchState) => {
  expect(state.status).toBe("ready");
  if (state.status !== "ready")
    throw new Error("Expected real completed search");
  return state;
};
async function owners() {
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
  const notes = await openNotesStore(identity),
    collections = await openCollectionsStore(identity);
  handles.add(notes);
  handles.add(collections);
  return { notes, collections };
}
it("rejects a genuine changed wrapping key during acquisition without retaining the query", async () => {
  const { notes, collections } = await owners();
  const replacement = await newWrappingKey();
  await mutateRecord<DeviceRecord>("devices", identity.email, (current) => {
    if (!current) throw new Error("Missing real fixture record");
    return { ...current, wrapKey: replacement };
  });
  const search = createLocalSearchService(notes, collections);
  handles.add(search);
  const revoked = vi.fn();
  search.onInvalidate(revoked);
  await search.query("private before source admission");
  expect(search.getSnapshot()).toEqual({ status: "idle", raw: "" });
  expect(revoked).toHaveBeenCalledWith("unverified");
});
it("searches a real encrypted mixed corpus, reuses the engine projection and revokes on save/lock", async () => {
  const { notes, collections } = await owners();
  const note = await notes.create({
    title: "Lisbon budget",
    tags: ["travel"],
    document: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Café and Straße" }],
        },
      ],
    },
  });
  const trashed = await notes.create({
    title: "Lisbon hidden",
    tags: [],
    document: { type: "doc", content: [] },
  });
  await notes.trash(trashed.id, 1);
  const current = await collections.read(),
    at = new Date("2026-01-01T00:00:00.000Z");
  await collections.update(current, (state) => {
    let study = createDeck(state.study, "Lisbon deck", at);
    study = saveEntry(
      study,
      {
        id: crypto.randomUUID(),
        deckId: study.decks[0]!.id,
        revision: 1,
        tags: [],
        source: null,
        type: "reversed",
        front: "Lisbon front",
        back: "Lisbon back",
      },
      at,
    );
    return {
      ...state,
      study,
      clips: {
        ...state.clips,
        items: [
          {
            id: crypto.randomUUID(),
            title: "Lisbon saved",
            originalUrl: "https://example.test/lisbon",
            canonicalUrl: "https://example.test/lisbon",
            text: "saved writing",
            createdAt: at.toISOString(),
            updatedAt: at.toISOString(),
            archivedAt: at.toISOString(),
            readAt: null,
            readLater: true,
            revision: 1,
          },
        ],
      },
    };
  });
  const search = createLocalSearchService(notes, collections);
  handles.add(search);
  const restores = vi.spyOn(SyncEngine, "restore");
  await search.query("lisbon");
  const first = ready(search.getSnapshot());
  expect(first.counts).toEqual({ notes: 1, clips: 1, cards: 2, all: 4 });
  expect(
    first.groups.find((group) => group.kind === "clip")!.items[0]!.archived,
  ).toBe(true);
  expect(
    first.groups
      .find((group) => group.kind === "card")!
      .items.map((hit) =>
        hit.locator.kind === "card" ? hit.locator.key : "wrong",
      ),
  ).toEqual(["reversed:forward", "reversed:reverse"]);
  // Collections was written after Notes last read. The first explicit admission
  // may refresh that owner once; unchanged subsequent queries must not restore.
  expect(restores).toHaveBeenCalledTimes(1);
  restores.mockClear();
  await search.query("strasse");
  expect(ready(search.getSnapshot()).counts.all).toBe(1);
  expect(restores).not.toHaveBeenCalled();
  const events: string[] = [];
  search.onInvalidate((reason) => {
    events.push(reason);
    expect(search.getSnapshot()).not.toHaveProperty("counts");
  });
  await notes.update(note.id, { title: "Porto budget" }, note.revision);
  expect(search.getSnapshot()).toEqual({ status: "changed", raw: "strasse" });
  await search.query("lisbon");
  expect(ready(search.getSnapshot()).counts).toEqual({
    notes: 0,
    clips: 1,
    cards: 2,
    all: 3,
  });
  lock(false);
  expect(search.getSnapshot()).toEqual({ status: "idle", raw: "" });
  expect(events).toContain("changed");
  expect(events).toContain("closed");
});
