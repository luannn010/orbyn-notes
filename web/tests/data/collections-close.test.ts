// @vitest-environment node
import { beforeAll, beforeEach, afterEach, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { IDBFactory } from "fake-indexeddb";
import { initSync, DeviceKeys } from "../../src/generated/wasm/orbyn_wasm.js";
import { establish, lock } from "../../src/account/session";
import {
  mutateRecord,
  newWrappingKey,
  wrappingSecret,
} from "../../src/data/database";
import type { DeviceRecord } from "../../src/data/database";
import type { CollectionsStore } from "../../src/collections/contracts";
import {
  openCollectionsStore,
  onCollectionsClose,
  assertCollectionsAccess,
} from "../../src/collections/store";

const identity = {
  accountId: "11111111-1111-4111-8111-111111111111",
  deviceId: "22222222-2222-4222-8222-222222222222",
  email: "collections-close@example.test",
  deviceState: "trusted" as const,
};
const handles = new Set<CollectionsStore>();
async function open() {
  const store = await openCollectionsStore(identity);
  handles.add(store);
  return store;
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
  const wrapKey = await newWrappingKey();
  const secret = await wrappingSecret(wrapKey);
  const keys = DeviceKeys.create();
  try {
    await mutateRecord<DeviceRecord>("devices", identity.email, () => ({
      ...identity,
      wrapKey,
      sealedKeys: keys.export(secret),
      generation: 0,
      verifiedTrust: true,
    }));
  } finally {
    secret.fill(0);
    keys.free();
  }
  establish(identity);
});
afterEach(() => {
  for (const store of handles) store.close();
  handles.clear();
  lock();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it.each(["close", "lock", "same-identity reauthentication"] as const)(
  "%s synchronously revokes a genuine borrowed owner exactly once",
  async (cause) => {
    const store = await open();
    let draft: string | null = "Unsaved private settings";
    const ordinary = vi.fn();
    store.subscribe(ordinary);
    const revoked = vi.fn(() => {
      expect(() => assertCollectionsAccess(store)).toThrow(/locked/);
      draft = null;
    });
    onCollectionsClose(store, revoked);
    if (cause === "close") store.close();
    else if (cause === "lock") lock();
    else establish(identity);
    expect(draft).toBeNull();
    expect(revoked).toHaveBeenCalledTimes(1);
    expect(ordinary).not.toHaveBeenCalled();
    store.close();
    expect(revoked).toHaveBeenCalledTimes(1);
    await expect(store.read()).rejects.toThrow(/locked/);
    expect(() => onCollectionsClose(store, vi.fn())).toThrow(/locked/);
  },
);

it("an unsubscribed close observer receives no notification", async () => {
  const store = await open();
  const observer = vi.fn();
  const stop = onCollectionsClose(store, observer);
  stop();
  stop();
  store.close();
  expect(observer).not.toHaveBeenCalled();
});

it("one failed observer cannot prevent other private consumers from revoking", async () => {
  const store = await open();
  onCollectionsClose(store, () => {
    throw new Error("synthetic observer error");
  });
  const second = vi.fn();
  onCollectionsClose(store, second);
  expect(() => store.close()).not.toThrow();
  expect(second).toHaveBeenCalledTimes(1);
  await expect(store.read()).rejects.toThrow(/locked/);
});

it("rejects a structural imitation rather than registering against another lifetime", () => {
  expect(() => onCollectionsClose({} as CollectionsStore, vi.fn())).toThrow(
    /locked/,
  );
});
