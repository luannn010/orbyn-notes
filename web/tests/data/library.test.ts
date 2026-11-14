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
  mutateRecord,
  newWrappingKey,
  readRecord,
  wrappingSecret,
} from "../../src/data/database";
import type { DeviceRecord } from "../../src/data/database";
import type {
  LibrarySnapshot,
  LibraryState,
  NotesLibraryStore,
} from "../../src/library/contracts";
import {
  LibraryConflictError,
  LibraryEpochError,
} from "../../src/library/contracts";
import { LIBRARY_ZONE } from "../../src/library/storage";
import { retainReceipts } from "../../src/library/model";
import {
  LIBRARY_LIMITS,
  jsonBytes,
  validateLibrary,
} from "../../src/library/validation";
import {
  emptyLibrary,
  projectLibraryNotes,
  retainHistory,
} from "../../src/library/model";
import { openCollectionsStore } from "../../src/collections/store";
const identity = {
  accountId: "11111111-1111-4111-8111-111111111111",
  deviceId: "22222222-2222-4222-8222-222222222222",
  email: "library@example.test",
  deviceState: "trusted" as const,
};
const input = {
  title: "Private synthetic note",
  document: {
    type: "doc" as const,
    content: [
      {
        type: "paragraph",
        content: [{ type: "text", text: "Private synthetic body" }],
      },
    ],
  },
  tags: ["source"],
};
const handles = new Set<{ close(): void }>();
async function open() {
  const store = await openNotesStore(identity);
  handles.add(store);
  return store;
}
async function ready(store: NotesLibraryStore): Promise<LibrarySnapshot> {
  const result = await store.library.read();
  if (result.mode !== "ready") throw new Error("fixture not ready");
  return result.snapshot;
}
async function inspect(change?: (state: LibraryState) => unknown) {
  const record = (await readRecord<DeviceRecord>("devices", identity.email))!,
    secret = await wrappingSecret(record.wrapKey);
  const keys = DeviceKeys.import(record.sealedKeys, secret),
    engine = SyncEngine.restore(keys, record.snapshot!, secret, Date.now());
  try {
    const state: LibraryState = JSON.parse(
      engine.record(LIBRARY_ZONE, "workspace")!,
    ).fields.library.value;
    if (!change) return state;
    const value = change(state);
    engine.stage(
      LIBRARY_ZONE,
      "notes_library_metadata",
      "workspace",
      JSON.stringify({
        library: { value, stamp: JSON.parse(engine.tick(Date.now())) },
      }),
    );
    const snapshot = engine.snapshot(secret);
    await mutateRecord<DeviceRecord>("devices", identity.email, (current) => ({
      ...current!,
      snapshot,
      generation: current!.generation + 1,
    }));
    return state;
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
    }));
  } finally {
    keys.free();
    secret.fill(0);
  }
  establish(identity);
});
afterEach(() => {
  for (const store of handles) store.close();
  handles.clear();
  vi.restoreAllMocks();
  vi.useRealTimers();
  lock();
});
describe("encrypted library metadata owner", () => {
  it("bounds receipt count/age while retaining a just-committed operation at the same instant", () => {
    const state = emptyLibrary(),
      now = Date.now();
    state.revision = 501;
    state.receipts = Array.from({ length: 501 }, (_, index) => ({
      id: String(index).padStart(8, "0") + "-1111-4111-8111-111111111111",
      epoch: state.epoch,
      committedAt: new Date(now).toISOString(),
      libraryRevision: index + 1,
      kind: "sort" as const,
      arguments: "[]",
      result: { type: "metadata" as const },
    }));
    const protectedId = state.receipts[0]!.id;
    retainReceipts(state, now, protectedId);
    expect(state.receipts).toHaveLength(500);
    expect(state.receipts.some((receipt) => receipt.id === protectedId)).toBe(
      true,
    );
    retainReceipts(state, now + 600001);
    expect(state.receipts).toEqual([]);
  });
  it("persists real pin/sort without changing document revision/date and composes filters", async () => {
    const store = await open(),
      a = await store.create({ ...input, title: "Zulu" }),
      b = await store.create({ ...input, title: "Alpha" });
    let state = await ready(store);
    state = (
      await store.library.setPinned(
        a.id,
        true,
        state.token,
        crypto.randomUUID(),
      )
    ).snapshot;
    state = (
      await store.library.setSort("title", state.token, crypto.randomUUID())
    ).snapshot;
    expect(await store.get(a.id)).toEqual(a);
    expect(await store.library.history(a.id)).toEqual([]);
    expect(projectLibraryNotes(state).map((note) => note.id)).toEqual([
      a.id,
      b.id,
    ]);
    expect(
      projectLibraryNotes(state, {
        pinnedOnly: true,
        query: "Zulu",
        tagId: state.tags[0]!.id,
      }),
    ).toHaveLength(1);
    store.close();
    const reopened = await ready(await open());
    expect(reopened.preferences.sort).toBe("title");
    expect(reopened.metadata.find((meta) => meta.noteId === a.id)!.pinned).toBe(
      true,
    );
    const record = (await readRecord<DeviceRecord>("devices", identity.email))!;
    expect(new TextDecoder().decode(record.snapshot)).not.toContain(
      "Private synthetic",
    );
    expect(Object.keys(record)).not.toContain("library");
  });
  it("atomically renames live and trashed references and rejects competing editor autosave", async () => {
    const a = await open(),
      b = await open();
    const first = await a.create(input),
      second = await a.create({ ...input, title: "Trashed" });
    await a.trash(second.id, second.revision);
    const state = await ready(a),
      tag = state.tags[0]!;
    const results = await Promise.allSettled([
      a.library.renameTag(tag.id, "renamed", state.token, crypto.randomUUID()),
      b.update(
        first.id,
        { tags: ["source"], title: "Autosave" },
        first.revision,
      ),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    const final = await ready(a),
      renamed =
        final.tags.find((tag) => tag.id === state.tags[0]!.id)!.name ===
        "renamed";
    expect(
      final.notes.every((note) =>
        note.tags.includes(renamed ? "renamed" : "source"),
      ),
    ).toBe(true);
    if (!renamed) {
      const committed = await a.library.renameTag(
        tag.id,
        "renamed",
        final.token,
        crypto.randomUUID(),
      );
      expect(
        committed.snapshot.notes.every((note) => note.tags[0] === "renamed"),
      ).toBe(true);
    }
  });
  it("flattens A→B→C aliases, preserves colors/history and deletes aliases without deleting notes", async () => {
    const store = await open();
    let note = await store.create({ ...input, tags: ["A", "B", "C"] });
    let state = await ready(store);
    const [a, b, c] = ["A", "B", "C"].map((name) =>
      state.tags.find((tag) => tag.name === name)!,
    );
    state = (
      await store.library.recolorTag(
        a!.id,
        "#ff0000",
        state.token,
        crypto.randomUUID(),
      )
    ).snapshot;
    note = await store.update(
      note.id,
      { title: "Capture colored tags" },
      note.revision,
    );
    const history = await store.library.history(note.id);
    state = await ready(store);
    state = (
      await store.library.mergeTag(
        a!.id,
        b!.id,
        state.token,
        crypto.randomUUID(),
      )
    ).snapshot;
    const stale = state.token;
    state = (
      await store.library.mergeTag(
        b!.id,
        c!.id,
        state.token,
        crypto.randomUUID(),
      )
    ).snapshot;
    expect(
      state.tags
        .filter((tag) => tag.state === "merged")
        .every((tag) => tag.mergedInto === c!.id),
    ).toBe(true);
    expect(state.notes[0]!.tags).toEqual(["C"]);
    await expect(
      store.library.deleteTag(c!.id, stale, crypto.randomUUID()),
    ).rejects.toBeInstanceOf(LibraryConflictError);
    state = (
      await store.library.deleteTag(c!.id, state.token, crypto.randomUUID())
    ).snapshot;
    expect(state.notes).toHaveLength(1);
    expect(state.notes[0]!.tags).toEqual([]);
    expect(
      state.tags.every(
        (tag) => tag.state === "deleted" && tag.mergedInto === null,
      ),
    ).toBe(true);
    expect(state.tags.find((tag) => tag.id === a!.id)!.color).toBe("#ff0000");
    expect(await store.library.history(note.id)).toEqual(history);
    const replacement = await store.library.createTag(
      { name: "A", color: null },
      state.token,
      crypto.randomUUID(),
    );
    expect(replacement.tag!.id).not.toBe(a!.id);
    expect(replacement.snapshot.metadata[0]!.tagIds).toEqual([]);
  });
  it("rolls back both records when a multi-note catalog mutation fails quota", async () => {
    const store = await open();
    await store.create(input);
    await store.create(input);
    const before = await ready(store);
    const put = vi
      .spyOn(IDBObjectStore.prototype, "put")
      .mockImplementationOnce(() => {
        throw new DOMException("Synthetic quota", "QuotaExceededError");
      });
    await expect(
      store.library.renameTag(
        before.tags[0]!.id,
        "Must not commit",
        before.token,
        crypto.randomUUID(),
      ),
    ).rejects.toThrow("Synthetic quota");
    put.mockRestore();
    expect(await ready(store)).toEqual(before);
  });
  it("recognizes an unknown-result receipt without replaying and rejects mismatching operation reuse", async () => {
    const store = await open(),
      note = await store.create(input),
      state = await ready(store),
      id = crypto.randomUUID();
    const post = vi
      .spyOn(BroadcastChannel.prototype, "postMessage")
      .mockImplementationOnce(() => {
        throw new Error("Synthetic post-commit notification failure");
      });
    await expect(
      store.library.setPinned(note.id, true, state.token, id),
    ).rejects.toThrow("notification failure");
    post.mockRestore();
    const before = (await readRecord<DeviceRecord>("devices", identity.email))!;
    const replay = await store.library.setPinned(
      note.id,
      true,
      state.token,
      id,
    );
    expect(replay.replayed).toBe(true);
    expect(replay.snapshot.metadata[0]!.pinned).toBe(true);
    expect(
      (await readRecord<DeviceRecord>("devices", identity.email))!.generation,
    ).toBe(before.generation);
    await expect(
      store.library.setPinned(note.id, false, state.token, id),
    ).rejects.toThrow("operation_conflict");
  });
  it("restores immutable title/document versions as a new revision while retaining current metadata and previous current", async () => {
    const store = await open();
    let note = await store.create(input);
    note = await store.update(
      note.id,
      {
        title: "New current",
        document: { type: "doc", content: [] },
        tags: ["new-tag"],
      },
      note.revision,
    );
    const original = (await store.library.history(note.id))[0]!;
    const value = await store.library.version(note.id, original.id);
    value!.title = "Mutated preview";
    expect((await store.library.version(note.id, original.id))!.title).toBe(
      input.title,
    );
    await store.library.setPinned(
      note.id,
      true,
      (await ready(store)).token,
      crypto.randomUUID(),
    );
    const result = await store.library.restoreVersion(
      note.id,
      original.id,
      note.revision,
      crypto.randomUUID(),
    );
    expect(result.note).toMatchObject({
      title: input.title,
      document: input.document,
      tags: ["new-tag"],
      revision: note.revision + 1,
      createdAt: note.createdAt,
    });
    expect(result.snapshot.metadata[0]!.pinned).toBe(true);
    expect(
      (await store.library.history(note.id)).some(
        (version) => version.title === "New current",
      ),
    ).toBe(true);
    const before = await store.library.history(note.id);
    await expect(
      store.library.restoreVersion(
        note.id,
        original.id,
        note.revision,
        crypto.randomUUID(),
      ),
    ).rejects.toThrow("another window");
    expect(await store.library.history(note.id)).toEqual(before);
  });
  it("enforces bounded history count and age without deleting current or legacy trash", async () => {
    const store = await open();
    let note = await store.create(input);
    for (let i = 0; i < 55; i++)
      note = await store.update(note.id, { title: String(i) }, note.revision);
    expect(await store.library.history(note.id)).toHaveLength(50);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 31 * 86400000);
    expect(await store.library.history(note.id)).toEqual([]);
    note = await store.update(
      note.id,
      { title: "After age pruning" },
      note.revision,
    );
    expect(await store.library.history(note.id)).toHaveLength(1);
    const moved = await store.trash(note.id, note.revision);
    vi.setSystemTime(Date.now() + 365 * 86400000);
    expect(await store.get(note.id)).toEqual(moved);
  });
  it("bounds UTF-8 history bytes and protects the latest capture when trimming", async () => {
    const now = Date.now(),
      state = emptyLibrary(),
      body = {
        type: "doc" as const,
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "界".repeat(650000) }],
          },
        ],
      };
    const note = {
      ...input,
      id: "opaque-legacy-id",
      createdAt: new Date(now).toISOString(),
      updatedAt: new Date(now).toISOString(),
      trashedAt: null,
      revision: 20,
      tags: [],
    };
    state.noteMetadata = [
      { noteId: note.id, revision: 1, pinned: false, tagIds: [] },
    ];
    state.versions = Array.from({ length: 6 }, (_, i) => ({
      id: crypto.randomUUID(),
      noteId: note.id,
      noteRevision: i + 1,
      capturedAt: new Date(now + i).toISOString(),
      reason: "edit" as const,
      title: String(i),
      document: body,
      tagsAtCapture: [],
    }));
    const protectedId = state.versions[5]!.id;
    retainHistory(state, now, protectedId);
    expect(state.versions.some((version) => version.id === protectedId)).toBe(
      true,
    );
    expect(state.versions.length).toBeLessThan(6);
    expect(jsonBytes(state.versions)).toBeLessThanOrEqual(
      LIBRARY_LIMITS.noteHistoryBytes,
    );
    expect(validateLibrary(state, [note]).versions).toHaveLength(
      state.versions.length,
    );
  });
  it("enforces aggregate history byte limits without evicting current notes or the protected version", () => {
    const now = Date.now(),
      state = emptyLibrary(),
      body = {
        type: "doc" as const,
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "界".repeat(650000) }],
          },
        ],
      };
    const notes = Array.from({ length: 18 }, (_, i) => ({
      ...input,
      id: "global-history-" + i,
      createdAt: new Date(now).toISOString(),
      updatedAt: new Date(now).toISOString(),
      trashedAt: null,
      revision: 2,
      tags: [],
    }));
    state.noteMetadata = notes.map((note) => ({
      noteId: note.id,
      revision: 1,
      pinned: false,
      tagIds: [],
    }));
    state.versions = notes.map((note, i) => ({
      id: crypto.randomUUID(),
      noteId: note.id,
      noteRevision: 1,
      capturedAt: new Date(now + i).toISOString(),
      reason: "edit" as const,
      title: "Old",
      document: body,
      tagsAtCapture: [],
    }));
    const protectedId = state.versions[0]!.id;
    retainHistory(state, now, protectedId);
    expect(state.versions.some((version) => version.id === protectedId)).toBe(
      true,
    );
    expect(jsonBytes(state.versions)).toBeLessThanOrEqual(
      LIBRARY_LIMITS.historyBytes,
    );
    expect(state.versions.length).toBeLessThan(18);
    expect(notes).toHaveLength(18);
  });
  it("does not create content history from equivalent object-key ordering", async () => {
    const store = await open();
    const note = await store.create(input);
    await store.update(
      note.id,
      {
        document: {
          content: [
            {
              content: [{ text: "Private synthetic body", type: "text" }],
              type: "paragraph",
            },
          ],
          type: "doc",
        },
      },
      note.revision,
    );
    expect(await store.library.history(note.id)).toEqual([]);
  });
  it("supports trash and restore Undo with the exact previous timestamp and rejects stale/expired reuse", async () => {
    const store = await open(),
      note = await store.create(input);
    const moved = await store.library.changeTrash(
      note.id,
      "trash",
      note.revision,
      crypto.randomUUID(),
    );
    const restored = await store.library.changeTrash(
      note.id,
      "restore",
      moved.note!.revision,
      crypto.randomUUID(),
    );
    const undidRestore = await store.library.undoTrash(
      restored.undo!,
      crypto.randomUUID(),
    );
    expect(undidRestore.note!.trashedAt).toBe(moved.note!.trashedAt);
    await expect(
      store.library.undoTrash(restored.undo!, crypto.randomUUID()),
    ).rejects.toThrow("undo_unavailable");
    const again = await store.library.changeTrash(
      note.id,
      "restore",
      undidRestore.note!.revision,
      crypto.randomUUID(),
    );
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 5001);
    await expect(
      store.library.undoTrash(again.undo!, crypto.randomUUID()),
    ).rejects.toThrow("undo_unavailable");
  });
  it("confirms exact Empty Trash revision, removes history and preserves collections data/epoch", async () => {
    const store = await open();
    let note = await store.create(input);
    note = await store.update(note.id, { title: "Has history" }, note.revision);
    await store.trash(note.id, note.revision);
    const collections = await openCollectionsStore(identity);
    handles.add(collections);
    const beforeCollections = await collections.read();
    const old = (await ready(store)).token;
    const keep = await store.create({ ...input, title: "Keep" });
    await expect(
      store.library.emptyTrash(old, crypto.randomUUID()),
    ).rejects.toBeInstanceOf(LibraryConflictError);
    const result = await store.library.emptyTrash(
      (await ready(store)).token,
      crypto.randomUUID(),
    );
    expect(result.removedCount).toBe(1);
    expect(await store.get(note.id)).toBeNull();
    expect(await store.get(keep.id)).toEqual(keep);
    expect(
      await store.library.version(note.id, crypto.randomUUID()),
    ).toBeNull();
    expect((await inspect()).versions).toEqual([]);
    expect(await collections.read()).toEqual(beforeCollections);
  });
  it.each(["create", "tag", "update", "history"] as const)(
    "fences delayed same-handle %s across erase before any effect",
    async (kind) => {
      const store = await open();
      let note = await store.create(input);
      note = await store.update(note.id, { title: "Current" }, note.revision);
      const state = await ready(store),
        version = (await store.library.history(note.id))[0]!;
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const real = crypto.subtle.sign.bind(crypto.subtle);
      vi.spyOn(crypto.subtle, "sign").mockImplementationOnce(
        async (algorithm, key, data) => {
          await gate;
          return real(algorithm, key, data);
        },
      );
      const pending =
        kind === "create"
          ? store.create(input)
          : kind === "tag"
            ? store.library.createTag(
                { name: "Old intent", color: null },
                state.token,
                crypto.randomUUID(),
              )
            : kind === "update"
              ? store.update(note.id, { title: "Old draft" }, note.revision)
              : store.library.restoreVersion(
                  note.id,
                  version.id,
                  note.revision,
                  crypto.randomUUID(),
                );
      await store.erase();
      release();
      await expect(pending).rejects.toBeInstanceOf(LibraryEpochError);
      expect(await store.list()).toEqual([]);
      expect((await ready(store)).tags).toEqual([]);
      expect(
        (await store.create({ ...input, title: "Fresh new epoch" })).title,
      ).toBe("Fresh new epoch");
    },
  );
  it("keeps foreign erased handles read-only until reopened and rejects future/corrupt metadata", async () => {
    const a = await open(),
      b = await open();
    await a.create(input);
    await a.erase();
    expect(await b.list()).toEqual([]);
    await expect(b.create(input)).rejects.toBeInstanceOf(LibraryEpochError);
    const reopened = await open();
    await reopened.create(input);
    reopened.close();
    await inspect((state) => ({ ...state, version: 4 }));
    await expect(openNotesStore(identity)).rejects.toThrow("library_invalid");
  });
  it("rolls back Empty Trash and whole-workspace erase on quota failure", async () => {
    const store = await open(),
      note = await store.create(input);
    await store.trash(note.id, note.revision);
    const before = await ready(store);
    const collections = await openCollectionsStore(identity);
    handles.add(collections);
    const collectionsBefore = await collections.read();
    for (const action of [
      () => store.library.emptyTrash(before.token, crypto.randomUUID()),
      () => store.erase(),
    ]) {
      const put = vi
        .spyOn(IDBObjectStore.prototype, "put")
        .mockImplementationOnce(() => {
          throw new DOMException("Synthetic quota", "QuotaExceededError");
        });
      await expect(action()).rejects.toThrow("Synthetic quota");
      put.mockRestore();
      expect(await ready(store)).toEqual(before);
      expect(await collections.read()).toEqual(collectionsBefore);
    }
  });
  it("revokes a metadata command awaiting wrapping crypto across same-ID reauthentication", async () => {
    const store = await open();
    await store.create(input);
    const before = await ready(store);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const sign = crypto.subtle.sign.bind(crypto.subtle);
    vi.spyOn(crypto.subtle, "sign").mockImplementationOnce(
      async (algorithm, key, data) => {
        await gate;
        return sign(algorithm, key, data);
      },
    );
    const pending = store.library.renameTag(
      before.tags[0]!.id,
      "Revoked rename",
      before.token,
      crypto.randomUUID(),
    );
    establish(identity);
    release();
    await expect(pending).rejects.toThrow("closed");
    expect(await ready(await open())).toEqual(before);
  });
});
