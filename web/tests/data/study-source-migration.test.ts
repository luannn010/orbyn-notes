// @vitest-environment node
import { beforeAll, beforeEach, afterEach, it, expect, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import {
  initSync,
  DeviceKeys,
  SyncEngine,
} from "../../src/generated/wasm/orbyn_wasm.js";
import {
  newWrappingKey,
  wrappingSecret,
  mutateRecord,
  readRecord,
} from "../../src/data/database";
import type { DeviceRecord } from "../../src/data/database";
import { establish, lock } from "../../src/account/session";
import { openNotesStore } from "../../src/data";
import { openCollectionsStore } from "../../src/collections/store";
import { createStudySourceService } from "../../src/study/sourceStore";
import {
  fingerprintSourceDocument,
  captureSourceSelection,
} from "../../src/study/sourceCodec";
import { adoptLibrary } from "../../src/library/model";
import {
  normalizeLibrary,
  validateLegacyLibrary,
  LEGACY_LIBRARY_BYTES,
  SOURCE_LIBRARY_OVERHEAD,
  SOURCE_LIBRARY_BYTES,
  LINK_LIBRARY_OVERHEAD,
  LIBRARY_LIMITS,
} from "../../src/library/validation";
import {
  emptyStudy,
  validateCollectionsV2,
  validateLegacyCollections,
} from "../../src/collections/validation";
import { createDeck } from "../../src/study/model";
import type { Note } from "../../src/domain/contracts";

const identity = {
  accountId: "11111111-1111-4111-8111-111111111111",
  deviceId: "22222222-2222-4222-8222-222222222222",
  email: "migration@example.test",
  deviceState: "trusted" as const,
};
const at = "2026-11-11T00:00:00.000Z",
  handles = new Set<{ close(): void }>();
const note: Note = {
  id: "legacy opaque source note",
  title: "Existing source",
  document: {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [{ type: "text", text: "Selected source" }],
      },
    ],
  },
  tags: [],
  createdAt: at,
  updatedAt: at,
  trashedAt: null,
  revision: 7,
};
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
async function seed(version: 1 | 2, corrupt = false) {
  const wrapKey = await newWrappingKey(),
    secret = await wrappingSecret(wrapKey),
    keys = DeviceKeys.create(),
    engine = SyncEngine.create(keys, identity.accountId, identity.deviceId);
  const {
    anchors: _,
    sourceReceipts: __,
    ...current
  } = adoptLibrary([note], [note], at);
  const library = { ...current, version: 1 };
  const study = createDeck(emptyStudy("UTC"), "Existing Study", new Date(at));
  const clip = {
    id: crypto.randomUUID(),
    revision: 1,
    originalUrl: "https://example.test/actual",
    canonicalUrl: "https://example.test/actual",
    title: "Actual saved Clip",
    text: "Existing pasted text",
    createdAt: at,
    updatedAt: at,
    readAt: null,
    readLater: true,
    archivedAt: null,
  };
  const journal = {
    version: 1,
    kdf: {
      name: "PBKDF2-SHA256",
      iterations: 600000,
      salt: btoa("s".repeat(16)),
    },
    iv: btoa("i".repeat(12)),
    ciphertext: btoa("c".repeat(16)),
  };
  const collections = {
    version,
    epoch: crypto.randomUUID(),
    revision: 9,
    study,
    journal,
    ...(version === 2 ? { clips: { items: [clip], receipts: [] } } : {}),
    ...(corrupt ? { foreign: true } : {}),
  };
  try {
    for (const [zone, type, recordId, field, value] of [
      ["notes-local", "notes_library", "library", "notes", [note]],
      [
        "notes-library-v1",
        "notes_library_metadata",
        "workspace",
        "library",
        library,
      ],
      [
        "notes-collections-v1",
        "notes_collections",
        "workspace",
        "collections",
        collections,
      ],
    ] as const) {
      engine.createZoneKey(zone);
      engine.stage(
        zone,
        type,
        recordId,
        JSON.stringify({
          [field]: { value, stamp: JSON.parse(engine.tick(Date.now())) },
        }),
      );
    }
    await mutateRecord<DeviceRecord>("devices", identity.email, () => ({
      ...identity,
      wrapKey,
      sealedKeys: keys.export(secret),
      snapshot: engine.snapshot(secret),
      generation: 12,
      verifiedTrust: true,
    }));
  } finally {
    engine.free();
    keys.free();
    secret.fill(0);
  }
  return { library, collections };
}
async function raw() {
  const stored = (await readRecord<DeviceRecord>("devices", identity.email))!,
    secret = await wrappingSecret(stored.wrapKey),
    keys = DeviceKeys.import(stored.sealedKeys, secret),
    engine = SyncEngine.restore(keys, stored.snapshot!, secret, Date.now());
  try {
    return {
      library: JSON.parse(engine.record("notes-library-v1", "workspace")!)
        .fields.library.value,
      collections: JSON.parse(
        engine.record("notes-collections-v1", "workspace")!,
      ).fields.collections.value,
    };
  } finally {
    engine.free();
    keys.free();
    secret.fill(0);
  }
}
it.each([1, 2] as const)(
  "strictly migrates raw Collections v%s and Library1 without rewriting; atomic source write preserves prior domains",
  async (version) => {
    const seeded = await seed(version),
      before = (await readRecord<DeviceRecord>("devices", identity.email))!;
    const put = vi.spyOn(IDBObjectStore.prototype, "put");
    const notes = await openNotesStore(identity),
      collections = await openCollectionsStore(identity);
    handles.add(notes);
    handles.add(collections);
    expect(put).not.toHaveBeenCalled();
    put.mockRestore();
    const current = await collections.read();
    expect(current.version).toBe(3);
    expect(current.study).toEqual(seeded.collections.study);
    expect(current.journal).toEqual(seeded.collections.journal);
    expect(current.clips.items).toHaveLength(version === 2 ? 1 : 0);
    const untouched = await raw();
    expect(untouched.library.version).toBe(1);
    expect(untouched.collections.version).toBe(version);
    expect(
      (await readRecord<DeviceRecord>("devices", identity.email))!.snapshot,
    ).toEqual(before.snapshot);
    const service = createStudySourceService(notes, collections);
    handles.add(service);
    const library = await notes.library.read();
    if (library.mode !== "ready") throw new Error("fixture library");
    const fingerprint = await fingerprintSourceDocument(note.document),
      selection = {
        noteId: note.id,
        noteRevision: note.revision,
        libraryEpoch: library.snapshot.token.epoch,
        fingerprint,
        passage: captureSourceSelection(note.document, 1, 9).passage,
      };
    const intent = await service.prepareCreate(
      selection,
      {
        library: library.snapshot.token,
        collections: { epoch: current.epoch, revision: current.revision },
      },
      {
        type: "basic",
        deckId: current.study.decks[0]!.id,
        tags: [],
        front: "Question",
        back: "Selected",
      },
    );
    const failingPut = vi
      .spyOn(IDBObjectStore.prototype, "put")
      .mockImplementationOnce(() => {
        throw new DOMException(
          "Synthetic migration quota",
          "QuotaExceededError",
        );
      });
    await expect(service.commit(intent)).rejects.toThrow("migration quota");
    failingPut.mockRestore();
    expect(
      (await readRecord<DeviceRecord>("devices", identity.email))!.snapshot,
    ).toEqual(before.snapshot);
    const result = await service.commit(intent),
      persisted = await raw();
    expect(result.source).toMatchObject({
      status: "attached",
      noteId: note.id,
      noteRevision: 7,
    });
    expect(persisted.library.version).toBe(2);
    expect(persisted.collections.version).toBe(3);
    expect(persisted.collections.clips).toEqual(current.clips);
    expect(persisted.collections.journal).toEqual(current.journal);
    expect(() => validateLegacyLibrary(persisted.library, [note])).toThrow(
      "library_invalid",
    );
    expect(() => validateCollectionsV2(persisted.collections)).toThrow(
      "collections_invalid",
    );
    expect(() => validateLegacyCollections(persisted.collections)).toThrow(
      "collections_invalid",
    );
  },
);
it.each([1, 2] as const)(
  "refuses malformed raw v%s without clearing or rewriting it",
  async (version) => {
    await seed(version, true);
    const before = (await readRecord<DeviceRecord>("devices", identity.email))!;
    await expect(openCollectionsStore(identity)).rejects.toThrow(
      "collections_invalid",
    );
    const after = (await readRecord<DeviceRecord>("devices", identity.email))!;
    expect(after.snapshot).toEqual(before.snapshot);
    expect(after.generation).toBe(before.generation);
  },
);
it("uses exact bounded structural overhead for Library1 normalization and validates strict legacy input first", async () => {
  const seeded = await seed(2),
    normalized = normalizeLibrary(seeded.library, [note]);
  const bytes = (value: unknown) =>
    new TextEncoder().encode(JSON.stringify(value)).byteLength;
  expect(bytes(normalized) - bytes(seeded.library)).toBe(
    SOURCE_LIBRARY_OVERHEAD,
  );
  expect(LEGACY_LIBRARY_BYTES).toBe(64 * 1024 * 1024);
  expect(SOURCE_LIBRARY_BYTES).toBe(
    LEGACY_LIBRARY_BYTES + SOURCE_LIBRARY_OVERHEAD,
  );
  expect(LIBRARY_LIMITS.bytes).toBe(
    SOURCE_LIBRARY_BYTES + LINK_LIBRARY_OVERHEAD,
  );
  expect(() =>
    normalizeLibrary({ ...seeded.library, unsupported: [] }, [note]),
  ).toThrow("library_invalid");
});
