// @vitest-environment node
import { beforeAll, beforeEach, it, expect, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import {
  initSync,
  DeviceKeys,
  SyncEngine,
  DeviceSession,
} from "../../src/generated/wasm/orbyn_wasm.js";
import { createAccountService } from "../../src/account";
import { lock, lockVersion } from "../../src/account/session";
import {
  newWrappingKey,
  wrappingSecret,
  mutateRecord,
  readRecord,
} from "../../src/data/database";
import type { SignupRecord, DeviceRecord } from "../../src/data/database";
import * as database from "../../src/data/database";
import {
  readCore,
  readLibrary,
  stageCore,
  stageLibrary,
  CORE_ZONE,
  LIBRARY_ZONE,
} from "../../src/library/storage";
import { emptyLibrary } from "../../src/library/model";
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
async function ceremony(
  cancelResponse = async (): Promise<Response> =>
    new Response(null, { status: 204 }),
) {
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
      if (url.endsWith("/cancel")) return cancelResponse();
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

it.each([204, 410])(
  "completes local approval cancellation for HTTP %i",
  async (status) => {
    const fixture = await ceremony(async () =>
      status === 204
        ? new Response(null, { status })
        : Response.json({ code: "approval_expired" }, { status }),
    );
    const freeSession = vi.spyOn(DeviceSession.prototype, "free");
    const freeEngine = vi.spyOn(SyncEngine.prototype, "free");
    try {
      const stored = await readRecord<DeviceRecord>("devices", email);
      const before = lockVersion();
      await expect(fixture.service.cancelDevice()).resolves.toBeUndefined();
      expect(lockVersion()).toBe(before + 1);
      expect(await fixture.service.current()).toBeNull();
      expect(await readRecord("devices", email)).toEqual(stored);
      expect(await readRecord("access", "active")).toBeUndefined();
      expect(freeSession).toHaveBeenCalledTimes(1);
      expect(freeEngine).toHaveBeenCalledTimes(1);
    } finally {
      fixture.close();
    }
  },
);

it.each([
  [401, "approval_expired"],
  [500, "approval_expired"],
  [410, "other_failure"],
  [404, "not_found"],
  [0, "network_error"],
] as const)(
  "preserves cancellation failure for HTTP %i / %s",
  async (status, code) => {
    const fixture = await ceremony(async () => {
      if (!status) throw new TypeError("Synthetic offline");
      return Response.json({ code }, { status });
    });
    const freeSession = vi.spyOn(DeviceSession.prototype, "free");
    try {
      const stored = await readRecord<DeviceRecord>("devices", email);
      const before = lockVersion();
      await expect(fixture.service.cancelDevice()).rejects.toMatchObject({
        code,
      });
      expect(lockVersion()).toBe(before);
      expect((await fixture.service.current())?.deviceState).toBe("pending");
      expect(await readRecord("devices", email)).toEqual(stored);
      expect(freeSession.mock.calls.length).toBe(0);
    } finally {
      lock();
      fixture.close();
    }
  },
);

it("does not swallow a stale approval-expired cancellation response after lock", async () => {
  let atServer = () => {};
  const requested = new Promise<void>((resolve) => (atServer = resolve));
  let respond = (_value: Response) => {};
  const fixture = await ceremony(
    () =>
      new Promise<Response>((resolve) => {
        respond = resolve;
        atServer();
      }),
  );
  const cancelling = fixture.service.cancelDevice();
  const cancelled = expect(cancelling).rejects.toMatchObject({
    code: "cancelled",
  });
  try {
    await requested;
    lock();
    const before = lockVersion();
    respond(Response.json({ code: "approval_expired" }, { status: 410 }));
    await cancelled;
    expect(lockVersion()).toBe(before);
  } finally {
    fixture.close();
  }
});

it("fences a lock between an expired HTTP result and the cancellation catch", async () => {
  const fixture = await ceremony(async () => {
    const response = Response.json(
      { code: "approval_expired" },
      { status: 410 },
    );
    vi.spyOn(response, "json").mockImplementation(async () => {
      queueMicrotask(() => queueMicrotask(() => lock()));
      return { code: "approval_expired" };
    });
    return response;
  });
  try {
    const before = lockVersion();
    await expect(fixture.service.cancelDevice()).rejects.toMatchObject({
      code: "cancelled",
    });
    expect(lockVersion()).toBe(before + 1);
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
    await expect(
      fixture.service.confirmDevice(fixture.sas),
    ).rejects.toMatchObject({
      code: "approval_missing",
    });
  } finally {
    fixture.close();
  }
});

it.each(["device-read", "wrapping-secret"])(
  "retries the same approval after a pre-checkpoint %s failure",
  async (failurePoint) => {
    const fixture = await ceremony();
    const finish = vi.spyOn(SyncEngine.prototype, "finishApproval");
    const freeSession = vi.spyOn(DeviceSession.prototype, "free");
    const freeEngine = vi.spyOn(SyncEngine.prototype, "free");
    try {
      const originalRead = database.readRecord;
      let reads = 0;
      const read = vi
        .spyOn(database, "readRecord")
        .mockImplementation(async (store, key) => {
          if (
            failurePoint === "device-read" &&
            store === "devices" &&
            ++reads === 2
          )
            throw new Error("Synthetic pre-checkpoint device read failure");
          return originalRead(store, key);
        });
      const secret = vi.spyOn(database, "wrappingSecret");
      if (failurePoint === "wrapping-secret")
        secret.mockRejectedValueOnce(
          new Error("Synthetic pre-checkpoint HMAC failure"),
        );
      await expect(
        fixture.service.confirmDevice(fixture.sas),
      ).rejects.toBeInstanceOf(Error);
      read.mockRestore();
      secret.mockRestore();
      expect(await readRecord("access", "active")).toBeUndefined();
      expect(
        (await readRecord<DeviceRecord>("devices", email))?.verifiedTrust,
      ).not.toBe(true);
      expect(fixture.posts()).toBe(0);
      const consumedBeforeRetry = finish.mock.calls.length;
      const retry = await fixture.service
        .confirmDevice(fixture.sas)
        .catch((error) => error);
      expect(retry).toMatchObject({ deviceState: "trusted" });
      expect(consumedBeforeRetry).toBe(0);
      expect(finish).toHaveBeenCalledTimes(1);
      expect(fixture.posts()).toBe(1);
      expect(freeSession).toHaveBeenCalledTimes(1);
      expect(freeEngine).toHaveBeenCalledTimes(2);
      expect(new Set(freeEngine.mock.instances).size).toBe(2);
    } finally {
      fixture.close();
    }
  },
);

it("locks during approval preparation without consuming or double-freeing the ceremony", async () => {
  const fixture = await ceremony();
  const finish = vi.spyOn(SyncEngine.prototype, "finishApproval");
  const freeSession = vi.spyOn(DeviceSession.prototype, "free");
  const freeEngine = vi.spyOn(SyncEngine.prototype, "free");
  let preparing = () => {};
  const atSecret = new Promise<void>((resolve) => (preparing = resolve));
  let release = () => {};
  const gate = new Promise<void>((resolve) => (release = resolve));
  const originalSecret = database.wrappingSecret;
  const secret = vi
    .spyOn(database, "wrappingSecret")
    .mockImplementationOnce(async (key) => {
      preparing();
      await gate;
      return originalSecret(key);
    });
  const confirming = fixture.service.confirmDevice(fixture.sas);
  const cancelled = expect(confirming).rejects.toMatchObject({
    code: "cancelled",
  });
  try {
    await atSecret;
    lock();
    release();
    await cancelled;
    expect(finish.mock.calls.length).toBe(0);
    expect(freeSession).toHaveBeenCalledTimes(1);
    expect(freeEngine).toHaveBeenCalledTimes(1);
    expect(fixture.posts()).toBe(0);
    expect(await readRecord("access", "active")).toBeUndefined();
    expect(
      (await readRecord<DeviceRecord>("devices", email))?.verifiedTrust,
    ).not.toBe(true);
  } finally {
    release();
    secret.mockRestore();
    fixture.close();
  }
});

it("preserves a newer local note when retrying a cached approval checkpoint", async () => {
  const fixture = await ceremony();
  try {
    const originalPut = IDBObjectStore.prototype.put;
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
          throw new DOMException(
            "Synthetic grant write abort",
            "QuotaExceededError",
          );
        }
        return originalPut.call(this, value, key);
      });
    await expect(
      fixture.service.confirmDevice(fixture.sas),
    ).rejects.toBeInstanceOf(Error);
    put.mockRestore();
    expect(fixture.posts()).toBe(1);

    // Simulate a committed write by a same-device window after server approval.
    const stored = (await readRecord<DeviceRecord>("devices", email))!;
    const secret = await wrappingSecret(stored.wrapKey);
    const keys = DeviceKeys.import(stored.sealedKeys, secret);
    const engine = SyncEngine.restore(
      keys,
      stored.snapshot!,
      secret,
      Date.now(),
    );
    const noteId = "44444444-4444-4444-8444-444444444444";
    try {
      const core = readCore(engine);
      stageCore(
        engine,
        [
          ...core.notes,
          {
            id: noteId,
            title: "Synthetic later-window note",
            document: { type: "doc", content: [] },
            tags: ["synthetic"],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            trashedAt: null,
            revision: 1,
          },
        ],
        core.exists,
      );
      const snapshot = engine.snapshot(secret);
      await mutateRecord<DeviceRecord>("devices", email, (current) => ({
        ...current!,
        snapshot,
        generation: current!.generation + 1,
      }));
    } finally {
      engine.free();
      keys.free();
      secret.fill(0);
    }
    expect((await fixture.service.confirmDevice(fixture.sas)).deviceState).toBe(
      "trusted",
    );
    const after = (await readRecord<DeviceRecord>("devices", email))!;
    const afterSecret = await wrappingSecret(after.wrapKey);
    const afterKeys = DeviceKeys.import(after.sealedKeys, afterSecret);
    const afterEngine = SyncEngine.restore(
      afterKeys,
      after.snapshot!,
      afterSecret,
      Date.now(),
    );
    try {
      expect(readCore(afterEngine).notes.map((note) => note.id)).toContain(
        noteId,
      );
      expect(after.approvalCheckpointId).toBe(stored.approvalCheckpointId);
      expect(fixture.posts()).toBe(1);
    } finally {
      afterEngine.free();
      afterKeys.free();
      afterSecret.fill(0);
    }
  } finally {
    fixture.close();
  }
});

async function interruptedApproval() {
  const fixture = await ceremony();
  const original = IDBObjectStore.prototype.put;
  const put = vi
    .spyOn(IDBObjectStore.prototype, "put")
    .mockImplementation(function (
      this: IDBObjectStore,
      value: unknown,
      key?: IDBValidKey,
    ) {
      if (this.name === "access")
        throw new DOMException(
          "Synthetic grant write abort",
          "QuotaExceededError",
        );
      return original.call(this, value, key);
    });
  try {
    await expect(
      fixture.service.confirmDevice(fixture.sas),
    ).rejects.toBeInstanceOf(Error);
  } finally {
    put.mockRestore();
  }
  expect(fixture.posts()).toBe(1);
  return fixture;
}

async function changeApprovalSnapshot(change: (engine: SyncEngine) => void) {
  const stored = (await readRecord<DeviceRecord>("devices", email))!;
  const secret = await wrappingSecret(stored.wrapKey);
  try {
    await mutateRecord<DeviceRecord>("devices", email, (current) => {
      const keys = DeviceKeys.import(current!.sealedKeys, secret);
      let engine: SyncEngine | undefined;
      try {
        engine = current!.snapshot
          ? SyncEngine.restore(keys, current!.snapshot, secret, Date.now())
          : SyncEngine.create(keys, current!.accountId, current!.deviceId);
        change(engine);
        return {
          ...current!,
          snapshot: engine.snapshot(secret),
          generation: current!.generation + 1,
        };
      } finally {
        engine?.free();
        keys.free();
      }
    });
  } finally {
    secret.fill(0);
  }
}

it("retains an erase's fresh library epoch on cached approval retry", async () => {
  const fixture = await interruptedApproval();
  try {
    const fresh = emptyLibrary();
    await changeApprovalSnapshot((engine) => {
      engine.purgeLocalZones(
        JSON.stringify([CORE_ZONE, LIBRARY_ZONE, "notes-collections-v1"]),
      );
      stageCore(engine, [], false);
      stageLibrary(engine, fresh, [], false);
    });
    const erased = (await readRecord<DeviceRecord>("devices", email))!;
    await fixture.service.confirmDevice(fixture.sas);
    const after = (await readRecord<DeviceRecord>("devices", email))!;
    expect(after.snapshot).toEqual(erased.snapshot);
    expect(after.generation).toBe(erased.generation);
    const secret = await wrappingSecret(after.wrapKey);
    const keys = DeviceKeys.import(after.sealedKeys, secret);
    const engine = SyncEngine.restore(
      keys,
      after.snapshot!,
      secret,
      Date.now(),
    );
    try {
      expect(readCore(engine).notes.length).toBe(0);
      expect(readLibrary(engine, [])?.epoch).toBe(fresh.epoch);
    } finally {
      engine.free();
      keys.free();
      secret.fill(0);
    }
  } finally {
    fixture.close();
  }
});

it.each([undefined, "different-checkpoint"])(
  "rejects cached proof with durable marker %s without changing data",
  async (marker) => {
    const fixture = await interruptedApproval();
    try {
      await mutateRecord<DeviceRecord>("devices", email, (record) => ({
        ...record!,
        approvalCheckpointId: marker,
        generation: record!.generation + 1,
      }));
      const before = await readRecord<DeviceRecord>("devices", email);
      await expect(
        fixture.service.confirmDevice(fixture.sas),
      ).rejects.toMatchObject({ code: "approval_snapshot_conflict" });
      expect(await readRecord("devices", email)).toEqual(before);
      expect(await readRecord("access", "active")).toBeUndefined();
      expect(fixture.posts()).toBe(1);
    } finally {
      fixture.close();
    }
  },
);

it("rejects a durable marker whose sealed checkpoint code changed", async () => {
  const fixture = await interruptedApproval();
  try {
    await changeApprovalSnapshot((engine) => {
      const raw = JSON.parse(
        engine.record("notes-local-approval", "verified-checkpoint")!,
      );
      const stamp = JSON.parse(engine.tick(Date.now()));
      engine.stage(
        "notes-local-approval",
        "approval_checkpoint",
        "verified-checkpoint",
        JSON.stringify({
          approvalId: { value: raw.fields.approvalId.value, stamp },
          code: {
            value: fixture.sas === "000000" ? "111111" : "000000",
            stamp,
          },
        }),
      );
    });
    const before = await readRecord<DeviceRecord>("devices", email);
    await expect(
      fixture.service.confirmDevice(fixture.sas),
    ).rejects.toMatchObject({ code: "approval_checkpoint_invalid" });
    expect(await readRecord("devices", email)).toEqual(before);
    expect(await readRecord("access", "active")).toBeUndefined();
  } finally {
    fixture.close();
  }
});

it("rejects changed device signing keys without reinstalling a cached snapshot", async () => {
  const fixture = await interruptedApproval();
  const replacement = DeviceKeys.create();
  try {
    const stored = (await readRecord<DeviceRecord>("devices", email))!;
    const secret = await wrappingSecret(stored.wrapKey);
    try {
      const sealedKeys = replacement.export(secret);
      await mutateRecord<DeviceRecord>("devices", email, (record) => ({
        ...record!,
        sealedKeys,
        generation: record!.generation + 1,
      }));
    } finally {
      secret.fill(0);
    }
    const before = await readRecord<DeviceRecord>("devices", email);
    await expect(
      fixture.service.confirmDevice(fixture.sas),
    ).rejects.toMatchObject({ code: "device_mismatch" });
    expect(await readRecord("devices", email)).toEqual(before);
    expect(await readRecord("access", "active")).toBeUndefined();
  } finally {
    replacement.free();
    fixture.close();
  }
});

it("rejects initial approval over an existing snapshot before consuming the ceremony", async () => {
  const fixture = await ceremony();
  const finish = vi.spyOn(SyncEngine.prototype, "finishApproval");
  try {
    await changeApprovalSnapshot((engine) => {
      stageCore(engine, [], false);
    });
    const before = await readRecord<DeviceRecord>("devices", email);
    await expect(
      fixture.service.confirmDevice(fixture.sas),
    ).rejects.toMatchObject({ code: "approval_snapshot_conflict" });
    expect(finish.mock.calls.length).toBe(0);
    expect(await readRecord("devices", email)).toEqual(before);
    expect(await readRecord("access", "active")).toBeUndefined();
    expect(fixture.posts()).toBe(0);
  } finally {
    fixture.close();
  }
});

it("fences a generation change between consuming approval and its first durable write", async () => {
  const fixture = await ceremony();
  const original = database.wrappingSecret;
  let calls = 0;
  const secret = vi
    .spyOn(database, "wrappingSecret")
    .mockImplementation(async (key) => {
      const value = await original(key);
      if (++calls === 2)
        await mutateRecord<DeviceRecord>("devices", email, (record) => ({
          ...record!,
          generation: record!.generation + 1,
        }));
      return value;
    });
  try {
    await expect(
      fixture.service.confirmDevice(fixture.sas),
    ).rejects.toMatchObject({ code: "approval_snapshot_conflict" });
    secret.mockRestore();
    const beforeRetry = (await readRecord<DeviceRecord>("devices", email))!;
    expect(beforeRetry.generation).toBe(1);
    expect(beforeRetry.snapshot).toBeUndefined();
    expect(beforeRetry.verifiedTrust).not.toBe(true);
    await expect(
      fixture.service.confirmDevice(fixture.sas),
    ).rejects.toMatchObject({ code: "approval_snapshot_conflict" });
    expect(await readRecord("devices", email)).toEqual(beforeRetry);
    expect(fixture.posts()).toBe(0);
  } finally {
    secret.mockRestore();
    fixture.close();
  }
});

it("does not reinstall a restored proof after its durable marker and snapshot disappear", async () => {
  const fixture = await interruptedApproval();
  try {
    const fresh = await fixture.reload();
    const original = database.wrappingSecret;
    let calls = 0;
    const secret = vi
      .spyOn(database, "wrappingSecret")
      .mockImplementation(async (key) => {
        const value = await original(key);
        if (++calls === 2)
          await mutateRecord<DeviceRecord>("devices", email, (record) => ({
            ...record!,
            verifiedTrust: false,
            approvalCheckpointId: undefined,
            snapshot: undefined,
          }));
        return value;
      });
    await expect(fresh.confirmDevice(fixture.sas)).rejects.toMatchObject({
      code: "approval_snapshot_conflict",
    });
    secret.mockRestore();
    expect(
      (await readRecord<DeviceRecord>("devices", email))?.snapshot,
    ).toBeUndefined();
    expect(await readRecord("access", "active")).toBeUndefined();
  } finally {
    fixture.close();
  }
});
