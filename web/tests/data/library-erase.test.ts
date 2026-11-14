// @vitest-environment node
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { readFile } from "node:fs/promises";
import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import {
  initSync,
  DeviceKeys,
  SyncEngine,
} from "../../src/generated/wasm/orbyn_wasm.js";
import { openNotesStore } from "../../src/data";
import { establish, lock } from "../../src/account/session";
import { createAccountService } from "../../src/account";
import { createClipsStore } from "../../src/clips/store";
import {
  newWrappingKey,
  wrappingSecret,
  mutateRecord,
  readRecord,
} from "../../src/data/database";
import type { DeviceRecord, LocalAccessGrant } from "../../src/data/database";
import {
  openCollectionsStore,
  replaceJournal,
} from "../../src/collections/store";
import {
  createJournalEnvelope,
  emptyJournal,
  unlockJournalEnvelope,
  writeJournalEntry,
} from "../../src/collections/journal";
const identity = {
  accountId: "11111111-1111-4111-8111-111111111111",
  deviceId: "22222222-2222-4222-8222-222222222222",
  email: "erase@example.test",
  deviceState: "trusted" as const,
};
const zones = ["notes-local", "notes-library-v1", "notes-collections-v1"];
const handles = new Set<{ close(): void }>();
type Upload = {
  changes: Array<{
    op: "save";
    record_id: string;
    record_type: string;
    ciphertext: string;
    wrapped_key: string;
  }>;
};
type PutEnvelope = {
  zone: string;
  key_id: string;
  envelope: string;
  rotation?: unknown;
};
function device(id: string, keys: DeviceKeys) {
  return {
    id,
    name: "Synthetic erase proof",
    platform: "web",
    state: "trusted",
    signing_key: keys.signingKey(),
    agreement_key: keys.agreementKey(),
    created_at: "2026-11-11T00:00:00Z",
    approved_by: null,
    approval_signature: null,
    current: false,
  };
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
      approvalCheckpointId: "synthetic-checkpoint",
    }));
    await mutateRecord<LocalAccessGrant>("access", "active", () => ({
      email: identity.email,
      accountId: identity.accountId,
      deviceId: identity.deviceId,
      signingKey: keys.signingKey(),
    }));
  } finally {
    keys.free();
    secret.fill(0);
  }
  establish(identity);
});
afterEach(() => {
  for (const handle of handles) handle.close();
  handles.clear();
  vi.restoreAllMocks();
  lock();
});
describe("post-erase engine residue", () => {
  it.each(["quota", "revision-exhausted", "foreign-owner"] as const)(
    "preserves the entire queued snapshot when erase fails at %s",
    async (failure) => {
      const store = await openNotesStore(identity);
      handles.add(store);
      await store.create({
        title: "Keep on failed erase",
        document: { type: "doc", content: [] },
        tags: [],
      });
      const collections = await openCollectionsStore(identity);
      handles.add(collections);
      await collections.read();
      const record = (await readRecord<DeviceRecord>(
          "devices",
          identity.email,
        ))!,
        secret = await wrappingSecret(record.wrapKey),
        keys = DeviceKeys.import(record.sealedKeys, secret),
        engine = SyncEngine.restore(keys, record.snapshot!, secret, Date.now());
      try {
        if (failure !== "quota") {
          const current = JSON.parse(
            engine.record("notes-collections-v1", "workspace")!,
          ).fields.collections.value;
          if (failure === "revision-exhausted")
            current.revision = Number.MAX_SAFE_INTEGER;
          else {
            engine.purgeLocalZones(JSON.stringify(["notes-collections-v1"]));
            engine.createZoneKey("notes-collections-v1");
          }
          engine.stage(
            "notes-collections-v1",
            failure === "foreign-owner"
              ? "foreign_collection_owner"
              : "notes_collections",
            "workspace",
            JSON.stringify({
              collections: {
                value: current,
                stamp: JSON.parse(engine.tick(Date.now())),
              },
            }),
          );
        }
        for (const zone of zones) engine.buildUpload(zone);
        const queued = engine.snapshot(secret);
        await mutateRecord<DeviceRecord>(
          "devices",
          identity.email,
          (current) => ({
            ...current!,
            snapshot: queued,
            generation: current!.generation + 1,
          }),
        );
      } finally {
        engine.free();
        keys.free();
        secret.fill(0);
      }
      const before = (await readRecord<DeviceRecord>(
        "devices",
        identity.email,
      ))!;
      const injected =
        failure === "quota"
          ? vi
              .spyOn(IDBObjectStore.prototype, "put")
              .mockImplementationOnce(() => {
                throw new DOMException(
                  "Synthetic purge quota",
                  "QuotaExceededError",
                );
              })
          : null;
      try {
        await expect(store.erase()).rejects.toThrow(
          failure === "quota"
            ? "purge quota"
            : failure === "foreign-owner"
              ? "collections_invalid"
              : "collections_revision_exhausted",
        );
      } finally {
        injected?.mockRestore();
      }
      const after = (await readRecord<DeviceRecord>(
        "devices",
        identity.email,
      ))!;
      expect(after.snapshot).toEqual(before.snapshot);
      expect(after.generation).toBe(before.generation);
      expect((await store.list())[0]?.title).toBe("Keep on failed erase");
    },
  );

  it("cannot recover removed Notes/history/catalog/Journal from retained queued batches and zone keys", async () => {
    const store = await openNotesStore(identity);
    handles.add(store);
    const note = await store.create({
      title: "ERASE-HISTORY-MARKER",
      document: { type: "doc", content: [] },
      tags: [],
    });
    await store.update(
      note.id,
      { title: "ERASE-CURRENT-MARKER" },
      note.revision,
    );
    const library = await store.library.read();
    if (library.mode !== "ready") throw new Error("fixture not ready");
    await store.library.createTag(
      { name: "ERASE-CATALOG-MARKER", color: null },
      library.snapshot.token,
      crypto.randomUUID(),
    );
    const collections = await openCollectionsStore(identity);
    handles.add(collections);
    const previous = await collections.read();
    const passphrase = "Synthetic erase Journal phrase";
    const data = writeJournalEntry(
      emptyJournal(),
      "2026-11-11",
      {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "ERASE-JOURNAL-MARKER" }],
          },
        ],
      },
      null,
      new Date(),
    );
    const created = await createJournalEnvelope(
      passphrase,
      data,
      { accountId: identity.accountId, epoch: previous.epoch },
      () => {},
    );
    await replaceJournal(collections, previous, created.envelope);
    const clips = createClipsStore(collections);
    handles.add(clips);
    await clips.commit(
      await clips.prepare(await clips.read(), {
        kind: "create",
        url: "https://example.test/ERASE-CLIP-URI-MARKER",
        title: "Actual synthetic clip",
        text: "ERASE-CLIP-TEXT-MARKER",
        readLater: true,
        allowDuplicate: false,
      }),
    );
    const beforeCollections = await collections.read();
    const beforeLibrary = await store.library.read();
    if (beforeLibrary.mode !== "ready") throw new Error("fixture not ready");
    const before = (await readRecord<DeviceRecord>("devices", identity.email))!,
      secret = await wrappingSecret(before.wrapKey),
      keys = DeviceKeys.import(before.sealedKeys, secret);
    const peerId = "33333333-3333-4333-8333-333333333333",
      peerKeys = DeviceKeys.create();
    const revokedId = "44444444-4444-4444-8444-444444444444",
      revokedKeys = DeviceKeys.create(),
      revokedDevice = device(revokedId, revokedKeys),
      revokedPublic = {
        signing: revokedKeys.signingKey(),
        agreement: revokedKeys.agreementKey(),
      };
    const devices = JSON.stringify({
      devices: [device(identity.deviceId, keys), device(peerId, peerKeys)],
    });
    const uploads = new Map<string, string>(),
      oldKeyIds = new Map<string, string[]>(),
      preservedRecords = new Map<string, string>(),
      preservedKeyIds = new Map<string, string[]>();
    let protection = "",
      nextRemovalSequence = 0;
    const engine = SyncEngine.restore(
      keys,
      before.snapshot!,
      secret,
      Date.now(),
    );
    try {
      engine.pinDevice(peerId, peerKeys.signingKey(), peerKeys.agreementKey());
      engine.pinDevice(
        revokedId,
        revokedPublic.signing,
        revokedPublic.agreement,
      );
      const removal = JSON.parse(
        engine.signRemoval(JSON.stringify(revokedDevice)),
      );
      engine.verifyDevices(
        JSON.stringify({
          devices: [...JSON.parse(devices).devices, revokedDevice],
          removals: [
            {
              device_id: revokedId,
              signing_key: revokedPublic.signing,
              agreement_key: revokedPublic.agreement,
              removed_by: identity.deviceId,
              ...removal,
            },
          ],
        }),
      );
      const signed = JSON.parse(
        engine.signProtection("advanced", Math.floor(Date.now() / 1000)),
      );
      engine.verifyProtection(
        JSON.stringify({
          links: [
            {
              level: signed.level,
              seq: signed.seq,
              prev: signed.prev,
              signed_at: signed.signed_at,
              signer_device_id: identity.deviceId,
              signature: signed.device_signature,
            },
          ],
          more: false,
        }),
        devices,
      );
      protection = engine.protectionLevel();
      nextRemovalSequence = JSON.parse(
        engine.signRemoval(JSON.stringify(device(peerId, peerKeys))),
      ).sequence;
      for (const zone of ["notes-local-approval", "unrelated-fixture"]) {
        engine.createZoneKey(zone);
        const stamp = JSON.parse(engine.tick(Date.now()));
        engine.stage(
          zone,
          zone === "notes-local-approval" ? "approval_checkpoint" : "sentinel",
          zone === "notes-local-approval" ? "verified-checkpoint" : "sentinel",
          JSON.stringify(
            zone === "notes-local-approval"
              ? {
                  approvalId: { value: "synthetic-checkpoint", stamp },
                  code: { value: "123456", stamp },
                }
              : { value: { value: "keep unrelated record", stamp } },
          ),
        );
        engine.buildUpload(zone);
        preservedRecords.set(
          zone,
          engine.record(
            zone,
            zone === "notes-local-approval"
              ? "verified-checkpoint"
              : "sentinel",
          )!,
        );
        preservedKeyIds.set(
          zone,
          (
            JSON.parse(engine.envelopesFor(zone, devices))
              .envelopes as PutEnvelope[]
          ).map((x) => x.key_id),
        );
      }
      for (const zone of zones) {
        const upload = engine.buildUpload(zone);
        if (!upload) throw new Error("fixture lacks batch");
        uploads.set(zone, upload);
      }
      const queuedSnapshot = engine.snapshot(secret);
      for (const zone of zones)
        oldKeyIds.set(
          zone,
          (
            JSON.parse(engine.envelopesFor(zone, devices))
              .envelopes as PutEnvelope[]
          ).map((envelope) => envelope.key_id),
        );
      await mutateRecord<DeviceRecord>(
        "devices",
        identity.email,
        (current) => ({
          ...current!,
          snapshot: queuedSnapshot,
          generation: current!.generation + 1,
        }),
      );
    } finally {
      engine.free();
      revokedKeys.free();
    }
    await store.erase();
    expect(await store.list()).toEqual([]);
    const currentCollections = await collections.read();
    expect(currentCollections.journal).toBeNull();
    expect(currentCollections.epoch).not.toBe(previous.epoch);
    expect(currentCollections.revision).toBe(beforeCollections.revision + 1);
    const currentLibrary = await store.library.read();
    if (currentLibrary.mode !== "ready")
      throw new Error("erased library not ready");
    expect(currentLibrary.snapshot.token.epoch).not.toBe(
      beforeLibrary.snapshot.token.epoch,
    );
    expect(currentLibrary.snapshot.token.revision).toBe(
      beforeLibrary.snapshot.token.revision + 1,
    );
    const after = (await readRecord<DeviceRecord>("devices", identity.email))!;
    expect(after.sealedKeys).toEqual(before.sealedKeys);
    expect(after.verifiedTrust).toBe(true);
    expect(after.approvalCheckpointId).toBe(before.approvalCheckpointId);
    expect(await readRecord("access", "active")).toMatchObject({
      accountId: identity.accountId,
      deviceId: identity.deviceId,
      signingKey: keys.signingKey(),
    });
    const post = SyncEngine.restore(keys, after.snapshot!, secret, Date.now()),
      peer = SyncEngine.create(peerKeys, identity.accountId, peerId);
    let retainedBatches = 0,
      retainedKeyIds = 0,
      recoverableMarkers = 0;
    try {
      expect(JSON.parse(post.verifyDevices(devices))).toEqual([
        identity.deviceId,
        peerId,
      ]);
      expect(post.protectionLevel()).toBe(protection);
      expect(
        JSON.parse(post.signRemoval(JSON.stringify(device(peerId, peerKeys))))
          .sequence,
      ).toBe(nextRemovalSequence);
      expect(() =>
        post.pinDevice(
          revokedId,
          revokedPublic.signing,
          revokedPublic.agreement,
        ),
      ).toThrow();
      for (const zone of preservedRecords.keys()) {
        expect(
          post.record(
            zone,
            zone === "notes-local-approval"
              ? "verified-checkpoint"
              : "sentinel",
          ) === preservedRecords.get(zone),
        ).toBe(true);
        const ids = (
          JSON.parse(post.envelopesFor(zone, devices))
            .envelopes as PutEnvelope[]
        ).map((x) => x.key_id);
        expect(
          JSON.stringify(ids) === JSON.stringify(preservedKeyIds.get(zone)),
        ).toBe(true);
      }
      peer.pinDevice(identity.deviceId, keys.signingKey(), keys.agreementKey());
      for (const zone of zones) {
        if (post.buildUpload(zone) === uploads.get(zone)) retainedBatches++;
        const envelopes = JSON.parse(post.envelopesFor(zone, devices))
          .envelopes as PutEnvelope[];
        retainedKeyIds += envelopes.filter((envelope) =>
          oldKeyIds.get(zone)!.includes(envelope.key_id),
        ).length;
        peer.acceptEnvelopes(
          JSON.stringify({
            envelopes: envelopes.map((envelope) => ({
              ...envelope,
              sender_device_id: identity.deviceId,
              created_at: "2026-11-11T00:00:00Z",
            })),
          }),
          devices,
        );
        const upload = JSON.parse(uploads.get(zone)!) as Upload;
        peer.applyChanges(
          zone,
          JSON.stringify({
            token: "synthetic-local-proof",
            more: false,
            zone_deleted: false,
            records: upload.changes.map((change) => ({
              record_id: change.record_id,
              record_type: change.record_type,
              version: 1,
              ciphertext: change.ciphertext,
              wrapped_key: change.wrapped_key,
              author_device_id: identity.deviceId,
              modified_at: "2026-11-11T00:00:00Z",
              deleted: false,
              delete_proof: null,
            })),
          }),
          Date.now(),
        );
      }
      const core = peer.record("notes-local", "library") ?? "",
        metadata = peer.record("notes-library-v1", "workspace") ?? "";
      recoverableMarkers +=
        Number(core.includes("ERASE-CURRENT-MARKER")) +
        Number(metadata.includes("ERASE-HISTORY-MARKER")) +
        Number(metadata.includes("ERASE-CATALOG-MARKER"));
      const oldCollections = peer.record("notes-collections-v1", "workspace");
      recoverableMarkers +=
        Number(oldCollections?.includes("ERASE-CLIP-URI-MARKER") ?? false) +
        Number(oldCollections?.includes("ERASE-CLIP-TEXT-MARKER") ?? false);
      if (oldCollections) {
        const recovered = JSON.parse(oldCollections).fields.collections.value;
        if (recovered.journal) {
          const opened = await unlockJournalEnvelope(
            recovered.journal,
            passphrase,
            { accountId: identity.accountId, epoch: recovered.epoch },
            () => {},
          );
          recoverableMarkers += Number(
            JSON.stringify(opened.data).includes("ERASE-JOURNAL-MARKER"),
          );
        }
      }
      // Only counts are asserted/output. No keys, envelopes or full snapshots leave this test.
      expect({ retainedBatches, retainedKeyIds, recoverableMarkers }).toEqual({
        retainedBatches: 0,
        retainedKeyIds: 0,
        recoverableMarkers: 0,
      });
      lock();
      const account = createAccountService({
        engineUrl: "http://127.0.0.1:9999",
      });
      expect(await account.current()).toEqual(identity);
    } finally {
      peer.free();
      post.free();
      peerKeys.free();
      keys.free();
      secret.fill(0);
    }
  });
});
