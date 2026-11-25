// @vitest-environment node
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { IDBFactory } from "fake-indexeddb";
import { initSync, DeviceKeys } from "../../src/generated/wasm/orbyn_wasm.js";
import { createAccountService } from "../../src/account";
import { lock, session } from "../../src/account/session";
import {
  mutateRecord,
  newWrappingKey,
  readRecord,
  wrappingSecret,
} from "../../src/data/database";
import type { SignupRecord } from "../../src/data/database";

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
  lock();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it.each([200, 400])(
  "cancels an abort-aware response body with HTTP %i",
  async (status) => {
    let signal: AbortSignal | undefined;
    let parsing = () => {};
    const atBody = new Promise<void>((resolve) => (parsing = resolve));
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        signal = init.signal!;
        const response = new Response("", { status });
        vi.spyOn(response, "json").mockImplementation(
          () =>
            new Promise((_resolve, reject) => {
              signal!.addEventListener("abort", () => reject(signal!.reason), {
                once: true,
              });
              parsing();
            }),
        );
        return response;
      }),
    );
    const service = createAccountService({
      engineUrl: "http://127.0.0.1:9999",
    });
    const checking = service.checkInvite("synthetic-invite");
    const cancelled = expect(checking).rejects.toMatchObject({
      code: "cancelled",
    });
    await atBody;
    lock();
    await cancelled;
    expect(signal?.aborted).toBe(true);
  },
);

it("rejects a late parsed verification response without caching it or granting access", async () => {
  const wrapKey = await newWrappingKey();
  const secret = await wrappingSecret(wrapKey);
  const keys = DeviceKeys.create();
  try {
    await mutateRecord<SignupRecord>("signups", "lock-signup", () => ({
      email: "lock@example.test",
      wrapKey,
      sealedKeys: keys.export(secret),
      createdAt: Date.now(),
    }));
  } finally {
    keys.free();
    secret.fill(0);
  }
  let parsing = () => {};
  const atBody = new Promise<void>((resolve) => (parsing = resolve));
  let finish = (_value: unknown) => {};
  const response = new Response("");
  vi.spyOn(response, "json").mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
        parsing();
      }),
  );
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(response)
    .mockResolvedValueOnce(
      Response.json({ code: "invalid_email_code" }, { status: 400 }),
    );
  vi.stubGlobal("fetch", fetch);
  const service = createAccountService({ engineUrl: "http://127.0.0.1:9999" });
  const verifying = service.verifyEmail({
    signupId: "lock-signup",
    code: "OLD",
  });
  const cancelled = expect(verifying).rejects.toMatchObject({
    code: "cancelled",
  });
  await atBody;
  lock();
  finish({
    token: "synthetic-stale-token",
    account_id: "11111111-1111-4111-8111-111111111111",
    device_id: "22222222-2222-4222-8222-222222222222",
    device_state: "trusted",
    expires_at: "2099-01-01T00:00:00Z",
  });
  await cancelled;
  expect(session()).toBeNull();
  expect(await readRecord("access", "active")).toBeUndefined();
  expect(await readRecord("devices", "lock@example.test")).toBeUndefined();
  expect(await readRecord("signups", "lock-signup")).toBeDefined();
  await expect(
    service.verifyEmail({ signupId: "lock-signup", code: "NEW" }),
  ).rejects.toMatchObject({
    code: "invalid_email_code",
  });
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(session()).toBeNull();
  expect(await readRecord("access", "active")).toBeUndefined();
});

it("fences a late error body even when its parser ignores abort", async () => {
  let parsing = () => {};
  const atBody = new Promise<void>((resolve) => (parsing = resolve));
  let finish = (_value: unknown) => {};
  const response = new Response("", { status: 400 });
  vi.spyOn(response, "json").mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
        parsing();
      }),
  );
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
  const service = createAccountService({ engineUrl: "http://127.0.0.1:9999" });
  const checking = service.checkInvite("synthetic-invite");
  const cancelled = expect(checking).rejects.toMatchObject({
    code: "cancelled",
  });
  await atBody;
  lock();
  finish({ code: "invite_invalid" });
  await cancelled;
});

it("preserves the transport timeout and removes its forwarding listener after settlement", async () => {
  const timeout = new AbortController();
  const createTimeout = vi
    .spyOn(AbortSignal, "timeout")
    .mockReturnValue(timeout.signal);
  const removeListener = vi.spyOn(timeout.signal, "removeEventListener");
  let signal: AbortSignal | undefined;
  vi.stubGlobal(
    "fetch",
    vi.fn((_url: string, init: RequestInit) => {
      signal = init.signal!;
      return new Promise<Response>((_resolve, reject) => {
        signal!.addEventListener("abort", () => reject(signal!.reason), {
          once: true,
        });
      });
    }),
  );
  const service = createAccountService({ engineUrl: "http://127.0.0.1:9999" });
  const checking = service.checkInvite("synthetic-invite");
  const failed = expect(checking).rejects.toMatchObject({
    code: "network_error",
  });
  timeout.abort(new DOMException("Synthetic timeout", "TimeoutError"));
  await failed;
  expect(createTimeout).toHaveBeenCalledWith(20000);
  expect(signal?.reason).toBe(timeout.signal.reason);
  expect(removeListener).toHaveBeenCalledWith("abort", expect.any(Function));
});

it("preserves normal responses, network failures, and malformed JSON failures", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(new Response(null, { status: 204 }))
    .mockRejectedValueOnce(new TypeError("Synthetic offline"))
    .mockResolvedValueOnce(new Response("not json"))
    .mockResolvedValueOnce(
      Response.json({ code: "invite_invalid" }, { status: 400 }),
    );
  vi.stubGlobal("fetch", fetch);
  const service = createAccountService({ engineUrl: "http://127.0.0.1:9999" });
  await expect(service.checkInvite("valid")).resolves.toBeUndefined();
  await expect(service.checkInvite("offline")).rejects.toMatchObject({
    code: "network_error",
  });
  await expect(service.checkInvite("malformed")).rejects.toMatchObject({
    code: "invalid_response",
  });
  await expect(service.checkInvite("invalid")).rejects.toMatchObject({
    code: "invite_invalid",
  });
});

it("aborts transport on lock, keeps serialization until rejection, then permits retry", async () => {
  let signal: AbortSignal | undefined;
  let finish = () => {};
  const fetch = vi.fn((_url: string, init: RequestInit) => {
    signal = init.signal!;
    return new Promise<Response>((resolve, reject) => {
      finish = () => resolve(new Response(null, { status: 204 }));
      signal!.addEventListener("abort", () => reject(signal!.reason), {
        once: true,
      });
    });
  });
  vi.stubGlobal("fetch", fetch);
  const service = createAccountService({ engineUrl: "http://127.0.0.1:9999" });
  const checking = service.checkInvite("synthetic-invite");
  const settled = checking.catch((error: unknown) => error);
  try {
    lock();
    const overlapping = service
      .checkInvite("too-early")
      .catch((error: unknown) => error);
    expect(signal?.aborted).toBe(true);
    expect(await overlapping).toMatchObject({ code: "request_busy" });
    await expect(checking).rejects.toMatchObject({ code: "cancelled" });
    fetch.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await expect(service.checkInvite("retry")).resolves.toBeUndefined();
    expect(fetch).toHaveBeenCalledTimes(2);
  } finally {
    finish();
    await settled;
  }
});
