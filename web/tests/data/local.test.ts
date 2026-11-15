// @vitest-environment node
import { beforeAll, beforeEach, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { IDBFactory } from "fake-indexeddb";
import { initSync } from "../../src/generated/wasm/orbyn_wasm.js";
import { openLocalSession, LOCAL_LIBRARY_KEY } from "../../src/data/local";
import { openNotesStore } from "../../src/data";
import {
  readRecord,
  mutateRecord,
  type DeviceRecord,
} from "../../src/data/database";
import { lock, session } from "../../src/account/session";
import { openCollectionsStore } from "../../src/collections/store";
import { createDeck, saveEntry } from "../../src/study/model";


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
it("opens without any account request, persists encrypted notes and reopens the same local identity", async () => {
  const network = vi.spyOn(globalThis, "fetch");
  const session = await openLocalSession();
  expect(session.email).toBe(LOCAL_LIBRARY_KEY);
  const store = await openNotesStore(session);
  const note = await store.create({
    title: "Guest private title",
    tags: [],
    document: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Guest private body" }],
        },
      ],
    },
  });
  store.close();
  lock();
  const reopenedSession = await openLocalSession();
  expect(reopenedSession).toEqual(session);
  const reopened = await openNotesStore(reopenedSession);
  expect(await reopened.get(note.id)).toEqual(note);
  const record = await readRecord<DeviceRecord>("devices", LOCAL_LIBRARY_KEY);
  expect(new TextDecoder().decode(record!.snapshot)).not.toContain(
    "Guest private",
  );
  expect(await readRecord("access", "active")).toBeUndefined();
  expect(network).not.toHaveBeenCalled();
  reopened.close();
  network.mockRestore();
});
it("preserves an existing account grant and device record when local mode starts", async () => {
  const sentinel = {
    email: "account@example.test",
    accountId: crypto.randomUUID(),
    deviceId: crypto.randomUUID(),
    signingKey: "synthetic-public-key",
  };
  await mutateRecord("access", "active", () => sentinel);
  await mutateRecord("devices", sentinel.email, () => ({
    marker: "existing account record",
  }));
  await openLocalSession();
  expect(await readRecord("access", "active")).toEqual(sentinel);
  expect(await readRecord("devices", sentinel.email)).toEqual({
    marker: "existing account record",
  });
});
it("serializes concurrent first opens onto one local library", async () => {
  const [a, b] = await Promise.all([openLocalSession(), openLocalSession()]);
  expect(a).toEqual(b);
});

it("does not reopen a local session after a lock during startup", async () => {
  const opening = openLocalSession();
  lock();
  await expect(opening).rejects.toMatchObject({ code: "cancelled" });
  expect(session()).toBeNull();
});

it("does not establish an abandoned local startup", async () => {
  await expect(openLocalSession(() => false)).rejects.toMatchObject({ code: "cancelled" });
  expect(session()).toBeNull();
});

it("keeps local Study collections across a session restart", async () => {
  const session = await openLocalSession();
  const collections = await openCollectionsStore(session);
  const before = await collections.read();
  const at = new Date("2026-11-15T12:00:00Z");
  const deck = createDeck(before.study, "Local testing deck", at);
  const study = saveEntry(deck, { id: crypto.randomUUID(), deckId: deck.decks[0]!.id,
    type: "basic", front: "Does this need an account?", back: "No", tags: [],
    source: null, revision: 1 }, at);
  await collections.update(before, current => ({ ...current, study }));
  collections.close();
  lock();
  const reopened = await openCollectionsStore(await openLocalSession());
  expect((await reopened.read()).study.entries[0]).toMatchObject({ front: "Does this need an account?", back: "No" });
  reopened.close();
});

it("reports storage denial without creating an account or grant", async () => {
  const network = vi.spyOn(globalThis, "fetch");
  vi.stubGlobal("indexedDB", { open: () => { throw new DOMException("Denied", "SecurityError"); } });
  await expect(openLocalSession()).rejects.toThrow("Denied");
  expect(network).not.toHaveBeenCalled();
  network.mockRestore();
});
