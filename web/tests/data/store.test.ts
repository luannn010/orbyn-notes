// @vitest-environment node
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import { initSync, DeviceKeys } from "../../src/generated/wasm/orbyn_wasm.js";
import { openNotesStore } from "../../src/data";
import {
  newWrappingKey,
  wrappingSecret,
  mutateRecord,
  readRecord,
} from "../../src/data/database";
import type { DeviceRecord } from "../../src/data/database";
import { establish, lock } from "../../src/account/session";
import { RevisionConflictError } from "../../src/domain/contracts";
const identity = {
  accountId: "11111111-1111-4111-8111-111111111111",
  deviceId: "22222222-2222-4222-8222-222222222222",
  email: "fixture@example.test",
  deviceState: "trusted" as const,
};
const input = {
  title: "Secret synthetic title",
  document: {
    type: "doc" as const,
    content: [
      {
        type: "paragraph",
        content: [{ type: "text", text: "Secret synthetic body" }],
      },
    ],
  },
  tags: ["private-fixture"],
};
async function seed() {
  const wrapKey = await newWrappingKey();
  expect(wrapKey.extractable).toBe(false);
  const secret = await wrappingSecret(wrapKey);
  const keys = DeviceKeys.create();
  try {
    await mutateRecord<DeviceRecord>("devices", identity.email, () => ({
      ...identity,
      wrapKey,
      sealedKeys: keys.export(secret),
      generation: 0,
    }));
  } finally {
    secret.fill(0);
    keys.free();
  }
  establish(identity);
}
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
  await seed();
});
describe("real WASM sealed notes library", () => {
  it("persists encrypted bytes, reopens and never stores plaintext note fields", async () => {
    const store = await openNotesStore(identity);
    const created = await store.create(input);
    store.close();
    const record = await readRecord<DeviceRecord>("devices", identity.email);
    expect(record?.snapshot).toBeInstanceOf(Uint8Array);
    const storedText = new TextDecoder().decode(record!.snapshot);
    expect(storedText).not.toContain(input.title);
    expect(storedText).not.toContain("Secret synthetic body");
    expect(Object.keys(record!)).not.toContain("notes");
    const reopened = await openNotesStore(identity);
    expect(await reopened.get(created.id)).toEqual(created);
    reopened.close();
  });
  it("serializes racing revisions across independent stores and preserves the loser draft", async () => {
    const a = await openNotesStore(identity);
    const b = await openNotesStore(identity);
    const note = await a.create(input);
    const outcomes = await Promise.allSettled([
      a.update(note.id, { title: "Writer A" }, 1),
      b.update(note.id, { title: "Writer B" }, 1),
    ]);
    expect(outcomes.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const failure = outcomes.find(
      (r) => r.status === "rejected",
    ) as PromiseRejectedResult;
    expect(failure.reason).toBeInstanceOf(RevisionConflictError);
    const persisted = await a.get(note.id);
    expect(persisted?.revision).toBe(2);
    expect(failure.reason.current).toEqual(persisted);
    expect(failure.reason.attempted.title).not.toBe(persisted?.title);
    a.close();
    b.close();
  });
  it("awaits transaction rollback and keeps the committed note on write failure", async () => {
    const store = await openNotesStore(identity);
    const note = await store.create(input);
    const put = vi
      .spyOn(IDBObjectStore.prototype, "put")
      .mockImplementationOnce(() => {
        throw new DOMException("Synthetic quota", "QuotaExceededError");
      });
    await expect(
      store.update(note.id, { title: "Must not commit" }, 1),
    ).rejects.toThrow("Synthetic quota");
    put.mockRestore();
    expect(store.persistence().status).toBe("failed");
    expect(await store.get(note.id)).toEqual(note);
    store.close();
  });
  it("keeps trash, restore and erase durable and revision checked", async () => {
    const store = await openNotesStore(identity);
    const note = await store.create(input);
    const trashed = await store.trash(note.id, 1);
    expect(trashed.trashedAt).not.toBeNull();
    await expect(store.restore(note.id, 1)).rejects.toBeInstanceOf(
      RevisionConflictError,
    );
    const restored = await store.restore(note.id, 2);
    expect(restored.trashedAt).toBeNull();
    expect(restored.revision).toBe(3);
    await store.erase();
    expect(await store.list()).toEqual([]);
    store.close();
    const reopened = await openNotesStore(identity);
    expect(await reopened.list()).toEqual([]);
    reopened.close();
  });
  it("locks existing handles and rejects account impersonation", async () => {
    const store = await openNotesStore(identity);
    await store.create(input);
    await expect(
      openNotesStore({
        ...identity,
        accountId: "33333333-3333-4333-8333-333333333333",
      }),
    ).rejects.toThrow("Sign in");
    lock();
    await expect(store.list()).rejects.toThrow("closed");
    await expect(openNotesStore(identity)).rejects.toThrow("Sign in");
    establish(identity);
    const reopened = await openNotesStore(identity);
    expect(await reopened.list()).toHaveLength(1);
    reopened.close();
  });
  it("rejects authenticated snapshot tampering instead of opening an empty library", async () => {
    const store = await openNotesStore(identity);
    await store.create(input);
    store.close();
    await mutateRecord<DeviceRecord>("devices", identity.email, (current) => {
      const snapshot = current!.snapshot!.slice();
      snapshot[20] = snapshot[20]! ^ 1;
      return { ...current!, snapshot };
    });
    await expect(openNotesStore(identity)).rejects.toThrow("open_failed");
  });
  it("does not persist mutated caller objects", async () => {
    const store = await openNotesStore(identity);
    const source = structuredClone(input);
    const note = await store.create(source);
    source.title = "Changed caller";
    note.title = "Changed result";
    expect((await store.list())[0]?.title).toBe(input.title);
    store.close();
  });
});

it("captures write inputs before asynchronous persistence yields to the caller", async () => {
  const store = await openNotesStore(identity);
  const source = structuredClone(input);
  const creating = store.create(source);
  source.title = "Changed before commit";
  const created = await creating;
  expect(created.title).toBe(input.title);
  const patch = { title: "Stable pending update" };
  const updating = store.update(created.id, patch, 1);
  patch.title = "Changed while updating";
  expect((await updating).title).toBe("Stable pending update");
  store.close();
});
