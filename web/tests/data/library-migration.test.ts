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
import {
  newWrappingKey,
  wrappingSecret,
  openDatabase,
  readRecord,
  mutateRecord,
} from "../../src/data/database";
import type { DeviceRecord } from "../../src/data/database";
import { LibraryReadOnlyError } from "../../src/library/contracts";
import { openCollectionsStore } from "../../src/collections/store";
import { LIBRARY_ZONE } from "../../src/library/storage";
import { exportMarkdown } from "../../src/transfer";
import { adoptLibrary } from "../../src/library/model";
import { validateNotes } from "../../src/domain/validation";
const identity = {
  accountId: "11111111-1111-4111-8111-111111111111",
  deviceId: "22222222-2222-4222-8222-222222222222",
  email: "legacy@example.test",
  deviceState: "trusted" as const,
};
const at = "2026-11-11T00:00:00.000Z";
const legacy = {
  id: "legacy opaque identity",
  title: "Legacy synthetic note",
  document: { type: "doc", content: [] },
  tags: ["Trip", "Trip", "trip", " padded ", "é", "é"],
  createdAt: "2026-11-10T10:00:00+11:00",
  updatedAt: at,
  trashedAt: null,
  revision: 7,
  unknownLegacyField: { preserve: true },
};
const handles = new Set<{ close(): void }>();
function oldDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("orbyn-notes-local-v1", 2);
    request.onupgradeneeded = () => {
      for (const store of ["devices", "signups", "access"])
        request.result.createObjectStore(store);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function seed(
  notes: unknown[],
  recordType = "notes_library",
  metadata?: { recordType: string; value: unknown },
) {
  const wrapKey = await newWrappingKey(),
    secret = await wrappingSecret(wrapKey),
    keys = DeviceKeys.create();
  const engine = SyncEngine.create(keys, identity.accountId, identity.deviceId);
  try {
    engine.createZoneKey("notes-local");
    engine.stage(
      "notes-local",
      recordType,
      "library",
      JSON.stringify({
        notes: { value: notes, stamp: JSON.parse(engine.tick(Date.now())) },
      }),
    );
    if (metadata) {
      engine.createZoneKey(LIBRARY_ZONE);
      engine.stage(
        LIBRARY_ZONE,
        metadata.recordType,
        "workspace",
        JSON.stringify({
          library: {
            value: metadata.value,
            stamp: JSON.parse(engine.tick(Date.now())),
          },
        }),
      );
    }
    const record: DeviceRecord = {
      ...identity,
      wrapKey,
      sealedKeys: keys.export(secret),
      snapshot: engine.snapshot(secret),
      generation: 0,
      verifiedTrust: true,
    };
    const db = await oldDatabase();
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction("devices", "readwrite");
        tx.objectStore("devices").put(record, identity.email);
        tx.oncomplete = () => resolve();
        tx.onabort = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
    return record;
  } finally {
    engine.free();
    keys.free();
    secret.fill(0);
  }
}
async function raw(record: DeviceRecord, zone = "notes-local", id = "library") {
  const secret = await wrappingSecret(record.wrapKey),
    keys = DeviceKeys.import(record.sealedKeys, secret),
    engine = SyncEngine.restore(keys, record.snapshot!, secret, Date.now());
  try {
    return engine.record(zone, id);
  } finally {
    engine.free();
    keys.free();
    secret.fill(0);
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
  lock();
  vi.stubGlobal("indexedDB", new IDBFactory());
  establish(identity);
});
afterEach(() => {
  for (const handle of handles) handle.close();
  handles.clear();
  vi.restoreAllMocks();
  lock();
});
describe("version3 writer admission and non-destructive adoption", () => {
  it.each(["core", "metadata"] as const)(
    "rejects valid payload under a foreign authenticated %s record owner",
    async (owner) => {
      const metadata = adoptLibrary(validateNotes([legacy]), [legacy], at);
      const before = await seed(
        [legacy],
        owner === "core" ? "foreign_core_owner" : "notes_library",
        owner === "metadata"
          ? { recordType: "foreign_metadata_owner", value: metadata }
          : undefined,
      );
      await expect(openNotesStore(identity)).rejects.toThrow("library_invalid");
      expect(
        (await readRecord<DeviceRecord>("devices", identity.email))!.snapshot,
      ).toEqual(before.snapshot);
    },
  );
  it("preserves old Trash on adoption and restores its exact original timestamp on Undo", async () => {
    const trashedAt = "2019-01-01T12:00:00+11:00";
    await seed([{ ...legacy, trashedAt }]);
    const store = await openNotesStore(identity);
    handles.add(store);
    expect((await store.get(legacy.id))!.trashedAt).toBe(trashedAt);
    const restored = await store.library.changeTrash(
      legacy.id,
      "restore",
      legacy.revision,
      crypto.randomUUID(),
    );
    const undone = await store.library.undoTrash(
      restored.undo!,
      crypto.randomUUID(),
    );
    expect(undone.note!.trashedAt).toBe(trashedAt);
  });
  it("adopts exact legacy labels once without rewriting core bytes, dates, IDs or unknown fields", async () => {
    const before = await seed([legacy]),
      beforeCore = await raw(before);
    const store = await openNotesStore(identity);
    handles.add(store);
    const result = await store.library.read();
    expect(result.mode).toBe("ready");
    if (result.mode !== "ready") return;
    expect(result.snapshot.tags.map((tag) => tag.name)).toEqual([
      ...new Set(legacy.tags),
    ]);
    expect(result.snapshot.tags.every((tag) => tag.color === null)).toBe(true);
    const after = (await readRecord<DeviceRecord>("devices", identity.email))!;
    expect(await raw(after)).toBe(beforeCore);
    expect(after.sealedKeys).toEqual(before.sealedKeys);
    const metadata = JSON.parse((await raw(after, LIBRARY_ZONE, "workspace"))!)
      .fields.library.value;
    expect(metadata.legacyDuplicateTags).toEqual([
      { noteId: legacy.id, values: legacy.tags },
    ]);
    expect(await store.get(legacy.id)).toMatchObject({
      id: legacy.id,
      createdAt: legacy.createdAt,
      unknownLegacyField: legacy.unknownLegacyField,
    });
    store.close();
    const reopened = await openNotesStore(identity);
    handles.add(reopened);
    expect(await reopened.library.read()).toEqual(result);
    expect(
      (await readRecord<DeviceRecord>("devices", identity.email))!.generation,
    ).toBe(after.generation);
  });
  it("drains the old transaction, then rejects old reopen/cached-connection effects after the fence", async () => {
    const record = await seed([legacy]),
      old = await oldDatabase();
    old.onversionchange = () => old.close();
    const transaction = old.transaction("devices", "readwrite");
    transaction
      .objectStore("devices")
      .put({ ...record, generation: 7 }, identity.email);
    const drained = new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error);
    });
    const opening = openNotesStore(identity);
    await drained;
    const store = await opening;
    handles.add(store);
    expect(
      (await readRecord<DeviceRecord>("devices", identity.email))!.generation,
    ).toBe(8);
    await expect(oldDatabase()).rejects.toMatchObject({ name: "VersionError" });
    expect(() => old.transaction("devices", "readwrite")).toThrow();
    const before = (await readRecord<DeviceRecord>("devices", identity.email))!;
    // A delayed legacy task must reopen with its hardcoded2 before it can write.
    await expect(
      (async () => {
        const stale = await oldDatabase();
        stale
          .transaction("devices", "readwrite")
          .objectStore("devices")
          .put(record, identity.email);
      })(),
    ).rejects.toMatchObject({ name: "VersionError" });
    expect(
      (await readRecord<DeviceRecord>("devices", identity.email))!.snapshot,
    ).toEqual(before.snapshot);
    expect(
      (
        await store.create({
          title: "Current writer control",
          document: { type: "doc", content: [] },
          tags: [],
        })
      ).revision,
    ).toBe(1);
  });
  it("fails a blocked upgrade without later silently converting after the caller has failed", async () => {
    await seed([legacy]);
    const old = await oldDatabase();
    await expect(openDatabase()).rejects.toThrow("storage_blocked");
    old.close();
    const retained = await oldDatabase();
    expect(retained.version).toBe(2);
    retained.close();
    const current = await openDatabase();
    expect(current.version).toBe(3);
    current.close();
  });
  it("opens oversized metadata profiles as real read/export-only data and requires fresh generation confirmation to erase", async () => {
    const notes = Array.from({ length: 101 }, (_, i) => ({
      ...legacy,
      id: "legacy-" + i,
      tags: Array.from({ length: 100 }, (_, j) => "tag-" + i + "-" + j),
    }));
    const before = await seed(notes),
      store = await openNotesStore(identity);
    handles.add(store);
    const result = await store.library.read();
    expect(result.mode).toBe("legacy-read-only");
    if (result.mode !== "legacy-read-only") return;
    expect(result).not.toHaveProperty("token");
    expect(result).not.toHaveProperty("snapshot");
    expect(await store.list()).toHaveLength(101);
    expect(exportMarkdown(await store.list())).toHaveLength(101);
    expect(
      (await readRecord<DeviceRecord>("devices", identity.email))!.snapshot,
    ).toEqual(before.snapshot);
    const put = vi.spyOn(IDBObjectStore.prototype, "put");
    await expect(
      store.create({
        title: "Must not create",
        document: { type: "doc", content: [] },
        tags: [],
      }),
    ).rejects.toBeInstanceOf(LibraryReadOnlyError);
    await expect(
      store.update(notes[0]!.id, { title: "Must not update" }, 7),
    ).rejects.toBeInstanceOf(LibraryReadOnlyError);
    await expect(store.erase()).rejects.toBeInstanceOf(LibraryReadOnlyError);
    expect(put).not.toHaveBeenCalled();
    put.mockRestore();
    const collections = await openCollectionsStore(identity);
    handles.add(collections);
    const previousCollections = await collections.read();
    await expect(
      store.library.eraseLegacy(
        {
          deviceGeneration: result.recovery.deviceGeneration,
          confirmation: "ERASE",
        },
        crypto.randomUUID(),
      ),
    ).rejects.toThrow("confirmation_stale");
    expect(await store.list()).toHaveLength(101);
    const fresh = await store.library.read();
    if (fresh.mode !== "legacy-read-only") throw new Error("fixture changed");
    const quota = vi
      .spyOn(IDBObjectStore.prototype, "put")
      .mockImplementationOnce(() => {
        throw new DOMException(
          "Synthetic recovery quota",
          "QuotaExceededError",
        );
      });
    await expect(
      store.library.eraseLegacy(
        {
          deviceGeneration: fresh.recovery.deviceGeneration,
          confirmation: "ERASE",
        },
        crypto.randomUUID(),
      ),
    ).rejects.toThrow("recovery quota");
    quota.mockRestore();
    expect(await store.list()).toHaveLength(101);
    expect((await collections.read()).epoch).toBe(previousCollections.epoch);
    const id = crypto.randomUUID(),
      erased = await store.library.eraseLegacy(
        {
          deviceGeneration: fresh.recovery.deviceGeneration,
          confirmation: "ERASE",
        },
        id,
      );
    expect(erased.snapshot.notes).toEqual([]);
    expect(erased.removedCount).toBe(101);
    expect(erased.snapshot.token.revision).toBe(1);
    const replay = await store.library.eraseLegacy(
      {
        deviceGeneration: fresh.recovery.deviceGeneration,
        confirmation: "ERASE",
      },
      id,
    );
    expect(replay.replayed).toBe(true);
    const currentCollections = await collections.read();
    expect(currentCollections.epoch).not.toBe(previousCollections.epoch);
    const after = (await readRecord<DeviceRecord>("devices", identity.email))!;
    expect(after.sealedKeys).toEqual(before.sealedKeys);
    expect(after.verifiedTrust).toBe(true);
    expect(
      (
        await store.create({
          title: "After explicit recovery",
          document: { type: "doc", content: [] },
          tags: [],
        })
      ).title,
    ).toBe("After explicit recovery");
  });
  it("rejects asynchronous transaction callbacks without writing or leaking an unhandled rejection", async () => {
    await seed([legacy]);
    const before = (await readRecord<DeviceRecord>("devices", identity.email))!;
    const change = (async () => {
      throw new Error("Synthetic async callback");
    }) as unknown as (record: DeviceRecord | undefined) => DeviceRecord;
    await expect(
      mutateRecord<DeviceRecord>("devices", identity.email, change),
    ).rejects.toThrow("must be synchronous");
    expect(
      (await readRecord<DeviceRecord>("devices", identity.email))!.snapshot,
    ).toEqual(before.snapshot);
  });
  it("preserves the pre-existing in-place transaction callback contract", async () => {
    await seed([legacy]);
    await mutateRecord<DeviceRecord>("devices", identity.email, (current) => {
      current!.generation = 12;
      return current;
    });
    expect(
      (await readRecord<DeviceRecord>("devices", identity.email))!.generation,
    ).toBe(12);
  });
});
