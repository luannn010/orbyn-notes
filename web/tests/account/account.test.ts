// @vitest-environment node
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import { initSync, DeviceKeys } from "../../src/generated/wasm/orbyn_wasm.js";
import { createAccountService } from "../../src/account";
import { openNotesStore } from "../../src/data";
import {
  newWrappingKey,
  wrappingSecret,
  mutateRecord,
  readRecord,
} from "../../src/data/database";
import type { SignupRecord, DeviceRecord } from "../../src/data/database";
import { lock } from "../../src/account/session";
const base = "http://127.0.0.1:9999";
const response = {
  token: "synthetic-token-not-production",
  account_id: "11111111-1111-4111-8111-111111111111",
  device_id: "22222222-2222-4222-8222-222222222222",
  device_state: "trusted",
  expires_at: "2099-01-01T00:00:00Z",
};
async function signup() {
  const wrapKey = await newWrappingKey();
  const secret = await wrappingSecret(wrapKey);
  const keys = DeviceKeys.create();
  try {
    await mutateRecord<SignupRecord>("signups", "fixture-signup", () => ({
      email: "fixture@example.test",
      wrapKey,
      sealedKeys: keys.export(secret),
      createdAt: Date.now(),
    }));
  } finally {
    secret.fill(0);
    keys.free();
  }
}
beforeAll(async () => {
  initSync({
    module: await readFile(
      new URL("../../src/generated/wasm/orbyn_wasm_bg.wasm", import.meta.url),
    ),
  });
});
beforeEach(() => {
  vi.stubEnv("VITE_ENGINE_URL", "");
  lock();
  vi.restoreAllMocks();
  vi.stubGlobal("indexedDB", new IDBFactory());
  vi.stubGlobal("localStorage", {
    getItem() {
      throw new Error("Forbidden localStorage");
    },
    setItem() {
      throw new Error("Forbidden localStorage");
    },
  });
});
describe("account adapter using real WASM device keys", () => {
  it("fails explicitly without endpoint configuration", async () => {
    await expect(
      createAccountService({ engineUrl: "" }).checkInvite("fixture"),
    ).rejects.toMatchObject({ code: "engine_unavailable" });
  });
  it("rejects insecure nonlocal endpoints", () => {
    expect(() =>
      createAccountService({ engineUrl: "http://example.test" }),
    ).toThrow("address is invalid");
  });
  it("checks invitation without consuming or storing it and preserves stable errors", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(
        Response.json(
          { code: "invite_invalid", message: "untrusted server text" },
          { status: 400 },
        ),
      );
    vi.stubGlobal("fetch", fetch);
    const service = createAccountService({ engineUrl: base });
    await service.checkInvite("fixture");
    expect(JSON.parse(fetch.mock.calls[0]![1].body)).toEqual({
      invite: "fixture",
    });
    await expect(service.checkInvite("bad")).rejects.toMatchObject({
      code: "invite_invalid",
      message: "This invitation is invalid or no longer available.",
    });
    expect(await service.current()).toBeNull();
  });
  it("wrong email code leaves signup keys intact and never creates a session", async () => {
    await signup();
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          Response.json({ code: "invalid_email_code" }, { status: 400 }),
        ),
    );
    const service = createAccountService({ engineUrl: base });
    await expect(
      service.verifyEmail({ signupId: "fixture-signup", code: "WRONG" }),
    ).rejects.toMatchObject({ code: "invalid_email_code" });
    expect(await readRecord("signups", "fixture-signup")).toBeDefined();
    expect(await readRecord("devices", "fixture@example.test")).toBeUndefined();
    expect(await service.current()).toBeNull();
  });
  it("seals verified device keys and retains library keys after failed login and sign-out", async () => {
    await signup();
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json(response))
      .mockRejectedValueOnce(new TypeError("offline"))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetch);
    const service = createAccountService({ engineUrl: base });
    const active = await service.verifyEmail({
      signupId: "fixture-signup",
      code: "FIXTURE",
    });
    expect(active.deviceState).toBe("trusted");
    const saved = await readRecord<DeviceRecord>("devices", active.email);
    expect(saved?.wrapKey.extractable).toBe(false);
    await expect(
      service.signIn({ email: active.email, password: "wrong-fixture" }),
    ).rejects.toMatchObject({ code: "network_error" });
    expect(await readRecord<DeviceRecord>("devices", active.email)).toEqual(
      saved,
    );
    await service.signOut();
    expect(await service.current()).toBeNull();
    expect(await readRecord<DeviceRecord>("devices", active.email)).toEqual(
      saved,
    );
  });
  it("returns a pending session without fabricating approval", async () => {
    await signup();
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          Response.json({ ...response, device_state: "pending" }),
        )
        .mockResolvedValueOnce(
          Response.json({
            device: { id: response.device_id, state: "pending" },
            approval: null,
          }),
        ),
    );
    const service = createAccountService({ engineUrl: base });
    expect(
      (
        await service.verifyEmail({
          signupId: "fixture-signup",
          code: "FIXTURE",
        })
      ).deviceState,
    ).toBe("pending");
    expect(await service.pendingDevice()).toEqual({ status: "waiting" });
    await expect(service.confirmDevice()).rejects.toMatchObject({
      code: "approval_missing",
    });
  });
  it("cancels a late response after sign-out", async () => {
    let finish: (value: Response) => void = () => {};
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            finish = resolve;
          }),
      ),
    );
    const service = createAccountService({ engineUrl: base });
    const checking = service.checkInvite("fixture");
    await service.signOut();
    finish(new Response(null, { status: 204 }));
    await expect(checking).rejects.toMatchObject({ code: "cancelled" });
  });
});

it("restores retained local access offline after reload and denies it after explicit sign-out", async () => {
  await signup();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(response)));
  const online = createAccountService({ engineUrl: base });
  const identity = await online.verifyEmail({
    signupId: "fixture-signup",
    code: "FIXTURE",
  });
  const store = await openNotesStore(identity);
  const note = await store.create({
    title: "Offline retained fixture",
    document: { type: "doc", content: [] },
    tags: [],
  });
  lock(false); // A fresh service has no bearer. The durable grant must suffice locally.
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
  const offline = createAccountService();
  const restoredResults = await Promise.all([
    offline.current(),
    offline.current(),
  ]);
  expect(restoredResults[1]).toEqual(identity);
  const restored = restoredResults[0];
  expect(restored).toEqual(identity);
  const reopened = await openNotesStore(restored!);
  expect(await reopened.get(note.id)).toEqual(note);
  await expect(offline.pendingDevice()).resolves.toEqual({ status: "trusted" }); // retained device trust; no HTTP request
  await offline.signOut();
  lock(false);
  expect(await createAccountService().current()).toBeNull();
  expect(await readRecord("access", "active")).toBeUndefined();
});

it("rejects a retained grant bound to a different device public key", async () => {
  await signup();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(response)));
  const service = createAccountService({ engineUrl: base });
  await service.verifyEmail({ signupId: "fixture-signup", code: "FIXTURE" });
  lock(false);
  await mutateRecord<Record<string, unknown>>(
    "access",
    "active",
    (current) => ({ ...current!, signingKey: "wrong-fixture-public-key" }),
  );
  await expect(createAccountService().current()).rejects.toMatchObject({
    code: "local_access_invalid",
  });
});

it.each(["devices", "access"])(
  "recovers consumed email verification after %s quota failure without submitting code twice",
  async (storeName) => {
    await signup();
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json(response))
      .mockResolvedValueOnce(
        Response.json({ code: "invalid_email_code" }, { status: 400 }),
      );
    vi.stubGlobal("fetch", fetch);
    const service = createAccountService({ engineUrl: base });
    const original = IDBObjectStore.prototype.put;
    let injected = false;
    const put = vi
      .spyOn(IDBObjectStore.prototype, "put")
      .mockImplementation(function (
        this: IDBObjectStore,
        value: unknown,
        key?: IDBValidKey,
      ) {
        if (!injected && this.name === storeName) {
          injected = true;
          throw new DOMException("Synthetic email quota", "QuotaExceededError");
        }
        return original.call(this, value, key);
      });
    await expect(
      service.verifyEmail({ signupId: "fixture-signup", code: "FIXTURE" }),
    ).rejects.toBeInstanceOf(Error);
    expect(injected).toBe(true);
    expect(await readRecord("access", "active")).toBeUndefined();
    put.mockRestore();
    expect(
      await service.verifyEmail({
        signupId: "fixture-signup",
        code: "FIXTURE",
      }),
    ).toMatchObject({ deviceState: "trusted" });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(await readRecord("signups", "fixture-signup")).toBeUndefined();
  },
);
