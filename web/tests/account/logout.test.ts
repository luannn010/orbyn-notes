// @vitest-environment node
import { beforeAll, beforeEach, it, expect, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { IDBFactory } from "fake-indexeddb";
import { initSync, DeviceKeys } from "../../src/generated/wasm/orbyn_wasm.js";
import { createAccountService, subscribeLock } from "../../src/account";
import * as database from "../../src/data/database";
import type { SignupRecord } from "../../src/data/database";
import { lock } from "../../src/account/session";
import { openNotesStore } from "../../src/data";
const response = {
  token: "synthetic-logout-token",
  account_id: "11111111-1111-4111-8111-111111111111",
  device_id: "22222222-2222-4222-8222-222222222222",
  device_state: "trusted",
  expires_at: "2099-01-01T00:00:00Z",
};
beforeAll(async () =>
  initSync({
    module: await readFile(
      new URL("../../src/generated/wasm/orbyn_wasm_bg.wasm", import.meta.url),
    ),
  }),
);
beforeEach(() => {
  lock();
  vi.restoreAllMocks();
  vi.stubEnv("VITE_ENGINE_URL", "");
  vi.stubGlobal("indexedDB", new IDBFactory());
});
async function authenticated() {
  const wrapKey = await database.newWrappingKey();
  const secret = await database.wrappingSecret(wrapKey);
  const keys = DeviceKeys.create();
  try {
    await database.mutateRecord<SignupRecord>(
      "signups",
      "logout-signup",
      () => ({
        email: "logout@example.test",
        wrapKey,
        sealedKeys: keys.export(secret),
        createdAt: Date.now(),
      }),
    );
  } finally {
    keys.free();
    secret.fill(0);
  }
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValueOnce(Response.json(response))
      .mockResolvedValue(new Response(null, { status: 204 })),
  );
  const service = createAccountService({ engineUrl: "http://127.0.0.1:9999" });
  const identity = await service.verifyEmail({
    signupId: "logout-signup",
    code: "FIXTURE",
  });
  return { service, identity };
}
it("invalidates access immediately but announces logout only after durable grant deletion", async () => {
  const { service, identity } = await authenticated();
  const store = await openNotesStore(identity);
  let publicLocks = 0;
  const unsubscribe = subscribeLock(() => publicLocks++);
  const real = database.mutateRecord;
  let release = () => {};
  const gate = new Promise<void>((resolve) => (release = resolve));
  const mutate = vi
    .spyOn(database, "mutateRecord")
    .mockImplementation(async (store, key, change) => {
      if (store === "access") await gate;
      return real(store, key, change);
    });
  const logout = service.signOut();
  try {
    expect(publicLocks).toBe(0);
    await expect(store.list()).rejects.toThrow();
    expect(await service.current()).toBeNull();
    expect(await createAccountService().current()).toBeNull();
    expect(await database.readRecord("access", "active")).toBeDefined();
  } finally {
    release();
    await logout;
    mutate.mockRestore();
    unsubscribe();
  }
  expect(publicLocks).toBe(1);
  expect(await database.readRecord("access", "active")).toBeUndefined();
  expect(await createAccountService().current()).toBeNull();
});
it("does not announce a completed logout when durable grant deletion aborts, and supports retry", async () => {
  const { service } = await authenticated();
  let publicLocks = 0;
  const unsubscribe = subscribeLock(() => publicLocks++);
  const original = database.mutateRecord;
  const mutate = vi
    .spyOn(database, "mutateRecord")
    .mockImplementationOnce(async () => {
      throw new DOMException("Synthetic logout quota", "QuotaExceededError");
    });
  try {
    await expect(service.signOut()).rejects.toBeInstanceOf(Error);
    expect(publicLocks).toBe(0);
    expect(await database.readRecord("access", "active")).toBeDefined();
    mutate.mockRestore();
    await service.signOut();
    expect(publicLocks).toBe(1);
    expect(await database.readRecord("access", "active")).toBeUndefined();
  } finally {
    mutate.mockRestore();
    unsubscribe();
  }
});

it("rejects late authentication and current restoration while logout deletion is pending", async () => {
  const { service } = await authenticated();
  const record = await database.readRecord<database.DeviceRecord>(
    "devices",
    "logout@example.test",
  );
  await database.mutateRecord<SignupRecord>("signups", "late-signup", () => ({
    email: record!.email,
    wrapKey: record!.wrapKey,
    sealedKeys: record!.sealedKeys,
    createdAt: Date.now(),
  }));
  let fetched = () => {};
  const atServer = new Promise<void>((resolve) => (fetched = resolve));
  let respond = (_value: Response) => {};
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.endsWith("/email/verify")) {
        fetched();
        return new Promise<Response>((resolve) => (respond = resolve));
      }
      return new Response(null, { status: 204 });
    }),
  );
  const lateService = createAccountService({
    engineUrl: "http://127.0.0.1:9999",
  });
  const late = lateService.verifyEmail({
    signupId: "late-signup",
    code: "FIXTURE",
  });
  await atServer;
  const real = database.mutateRecord;
  let release = () => {};
  const gate = new Promise<void>((resolve) => (release = resolve));
  const mutate = vi
    .spyOn(database, "mutateRecord")
    .mockImplementation(async (store, key, change) => {
      if (store === "access") await gate;
      return real(store, key, change);
    });
  const logout = service.signOut();
  try {
    respond(Response.json(response));
    await expect(late).rejects.toMatchObject({ code: "cancelled" });
    expect(await lateService.current()).toBeNull();
    expect(await createAccountService().current()).toBeNull();
  } finally {
    release();
    await logout;
    mutate.mockRestore();
  }
  expect(await database.readRecord("access", "active")).toBeUndefined();
  expect(await lateService.current()).toBeNull();
});
