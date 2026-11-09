// @vitest-environment node
import { beforeAll, beforeEach, it, expect, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import {
  initSync,
  DeviceKeys,
  SyncEngine,
} from "../../src/generated/wasm/orbyn_wasm.js";
import { createAccountService } from "../../src/account";
import { lock } from "../../src/account/session";
import {
  newWrappingKey,
  wrappingSecret,
  mutateRecord,
  readRecord,
} from "../../src/data/database";
import type { SignupRecord, DeviceRecord } from "../../src/data/database";
const accountId = "11111111-1111-4111-8111-111111111111",
  deviceId = "22222222-2222-4222-8222-222222222222",
  approverId = "33333333-3333-4333-8333-333333333333",
  email = "pairing@example.test";
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
  vi.stubGlobal("indexedDB", new IDBFactory());
});
async function ceremony() {
  const pendingKeys = DeviceKeys.create(),
    trustedKeys = DeviceKeys.create();
  const wrapKey = await newWrappingKey();
  const secret = await wrappingSecret(wrapKey);
  try {
    await mutateRecord<SignupRecord>("signups", "pending", () => ({
      email,
      wrapKey,
      sealedKeys: pendingKeys.export(secret),
      createdAt: Date.now(),
    }));
  } finally {
    secret.fill(0);
  }
  const trustedEngine = SyncEngine.create(trustedKeys, accountId, approverId);
  const pendingDevice = {
    id: deviceId,
    name: "Synthetic pending",
    platform: "web",
    state: "pending",
    signing_key: pendingKeys.signingKey(),
    agreement_key: pendingKeys.agreementKey(),
    created_at: new Date().toISOString(),
    approved_by: null,
    approval_signature: null,
    current: true,
  };
  const approver = {
    ...pendingDevice,
    id: approverId,
    name: "Synthetic trusted",
    state: "trusted",
    signing_key: trustedKeys.signingKey(),
    agreement_key: trustedKeys.agreementKey(),
    current: false,
  };
  const started = trustedEngine.startApproval(
    JSON.stringify(pendingDevice),
    Date.now() / 1000,
  );
  const create = JSON.parse(started.createJson);
  const view = {
    id: create.approval_id,
    expires_at: new Date(Date.now() + 300000).toISOString(),
    created_at: create.created_at,
    approver_id: approverId,
    approver_signing_key: trustedKeys.signingKey(),
    approver_agreement_key: trustedKeys.agreementKey(),
    device_id: deviceId,
    device_signing_key: pendingKeys.signingKey(),
    device_agreement_key: pendingKeys.agreementKey(),
    commitment: create.commitment,
    device_nonce: null,
    approver_nonce: null,
    signature: null,
    endorsement: null,
  };
  let serverTrusted = false,
    posts = 0;
  let expectedSas: string | undefined;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, options: { body?: string }) => {
      if (url.endsWith("/email/verify"))
        return Response.json({
          token: "synthetic-pairing-token",
          account_id: accountId,
          device_id: deviceId,
          device_state: "pending",
          expires_at: "2099-01-01T00:00:00Z",
        });
      if (url.endsWith("/devices/current"))
        return Response.json({
          device: {
            ...pendingDevice,
            state: serverTrusted ? "trusted" : "pending",
          },
          approval: serverTrusted ? null : view,
          totp_enabled: false,
          totp_pending: false,
        });
      if (url.endsWith("/nonce")) {
        view.device_nonce = JSON.parse(options.body!).nonce;
        return new Response(null, { status: 204 });
      }
      if (url.endsWith("/code")) {
        expect(JSON.parse(options.body!).code).toBe(expectedSas);
        serverTrusted = true;
        posts++;
        return Response.json({ ...pendingDevice, state: "trusted" });
      }
      throw new Error("Unexpected synthetic HTTP path");
    }),
  );
  const service = createAccountService({ engineUrl: "http://127.0.0.1:9999" });
  await service.verifyEmail({ signupId: "pending", code: "FIXTURE" });
  await service.pendingDevice();
  view.approver_nonce = JSON.parse(started.reveal(JSON.stringify(view))).nonce;
  const compared = await service.pendingDevice();
  expect(compared.status).toBe("compare");
  expect(compared.sas).toBe(started.sas());
  await expect(service.confirmDevice(compared.sas)).rejects.toMatchObject({
    code: "approval_waiting",
  });
  expect(await readRecord("access", "active")).toBeUndefined();
  expect(
    (await readRecord<DeviceRecord>("devices", email))?.verifiedTrust,
  ).not.toBe(true);
  expectedSas = compared.sas;
  Object.assign(
    view,
    JSON.parse(
      trustedEngine.confirmApproval(
        started,
        JSON.stringify({ devices: [approver, pendingDevice], removals: [] }),
      ),
    ),
  );
  return {
    service,
    sas: compared.sas!,
    posts: () => posts,
    async reload() {
      lock(false);
      const record = await readRecord<DeviceRecord>("devices", email);
      await mutateRecord<SignupRecord>("signups", "reloaded-session", () => ({
        email,
        wrapKey: record!.wrapKey,
        sealedKeys: record!.sealedKeys,
        createdAt: Date.now(),
      }));
      const fresh = createAccountService({
        engineUrl: "http://127.0.0.1:9999",
      });
      await fresh.verifyEmail({
        signupId: "reloaded-session",
        code: "FIXTURE",
      });
      return fresh;
    },
    close() {
      started.free();
      trustedEngine.free();
      trustedKeys.free();
      pendingKeys.free();
    },
  };
}
it.each(["devices", "access"])(
  "recovers real paired approval after %s quota abort without deleting keys",
  async (storeName) => {
    const fixture = await ceremony();
    try {
      const original = IDBObjectStore.prototype.put;
      let injected = false;
      const put = vi
        .spyOn(IDBObjectStore.prototype, "put")
        .mockImplementation(function (
          this: IDBObjectStore,
          value: unknown,
          ...args: Parameters<IDBObjectStore["put"]> extends [
            unknown,
            ...infer R,
          ]
            ? R
            : never
        ) {
          if (
            !injected &&
            this.name === storeName &&
            (storeName === "access" || (value as DeviceRecord).verifiedTrust)
          ) {
            injected = true;
            throw new DOMException(
              "Synthetic pairing quota",
              "QuotaExceededError",
            );
          }
          return original.call(this, value, ...args);
        });
      const failure = await fixture.service
        .confirmDevice(fixture.sas)
        .catch((error) => error);
      expect(failure).toBeInstanceOf(Error);
      expect(injected).toBe(true);
      expect(await readRecord("access", "active")).toBeUndefined();
      put.mockRestore();
      const recovered = await fixture.service.confirmDevice(fixture.sas);
      expect(recovered.deviceState).toBe("trusted");
      expect(
        (await readRecord<DeviceRecord>("devices", email))?.verifiedTrust,
      ).toBe(true);
      expect(await readRecord("access", "active")).toBeDefined();
      expect(fixture.posts()).toBe(1);
    } finally {
      fixture.close();
    }
  },
);

it("restores sealed verified approval after reload when server acknowledgement succeeded but grant storage aborted", async () => {
  const fixture = await ceremony();
  try {
    const original = IDBObjectStore.prototype.put;
    let failed = false;
    const put = vi
      .spyOn(IDBObjectStore.prototype, "put")
      .mockImplementation(function (
        this: IDBObjectStore,
        value: unknown,
        key?: IDBValidKey,
      ) {
        if (!failed && this.name === "access") {
          failed = true;
          throw new DOMException("Synthetic grant abort", "QuotaExceededError");
        }
        return original.call(this, value, key);
      });
    await expect(fixture.service.confirmDevice(fixture.sas)).rejects.toThrow();
    put.mockRestore();
    expect(fixture.posts()).toBe(1);
    expect(await readRecord("access", "active")).toBeUndefined();
    const fresh = await fixture.reload();
    expect(await readRecord("access", "active")).toBeUndefined();
    expect(await fresh.pendingDevice()).toEqual({ status: "trusted" });
    expect((await fresh.current())?.deviceState).toBe("trusted");
    expect(fixture.posts()).toBe(1);
  } finally {
    fixture.close();
  }
});

it("never checkpoints trust or grants access for a human code that WASM rejects", async () => {
  const fixture = await ceremony();
  try {
    await expect(
      fixture.service.confirmDevice(
        fixture.sas === "000000" ? "111111" : "000000",
      ),
    ).rejects.toBeInstanceOf(Error);
    expect(fixture.posts()).toBe(0);
    expect(await readRecord("access", "active")).toBeUndefined();
    expect(
      (await readRecord<DeviceRecord>("devices", email))?.verifiedTrust,
    ).not.toBe(true);
  } finally {
    fixture.close();
  }
});
