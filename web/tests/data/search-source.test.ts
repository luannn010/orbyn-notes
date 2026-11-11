import {
  notesSearchData,
  collectionsSearchData,
} from "../../src/search/source";
import { initialSchedule } from "../../src/study/scheduler";
import {
  acquireSearchSource,
  assertSearchSourceFresh,
  searchSourceReader,
  onSearchSourceInvalidated,
  releaseSearchSource,
} from "../../src/search/source";
import type { SearchLease } from "../../src/search/contracts";
import { SearchSourceError } from "../../src/search/contracts";
import { noteLinkOwner, studySourceOwner } from "../../src/library/store";
import { createDeck, saveEntry } from "../../src/study/model";
import { replaceJournal } from "../../src/collections/store";
import {
  emptyJournal,
  createJournalEnvelope,
} from "../../src/collections/journal";
import { protectOperations } from "../../src/desktop/closeGuard";
// @vitest-environment node
import { beforeAll, afterEach, it, expect, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import {
  initSync,
  DeviceKeys,
  SyncEngine,
} from "../../src/generated/wasm/orbyn_wasm.js";
import { lock, establish } from "../../src/account/session";
import {
  newWrappingKey,
  wrappingSecret,
  mutateRecord,
  readRecord,
} from "../../src/data/database";
import type { DeviceRecord } from "../../src/data/database";
import { openNotesStore } from "../../src/data";
import { openCollectionsStore } from "../../src/collections/store";
const identity = {
  accountId: "11111111-1111-4111-8111-111111111111",
  deviceId: "22222222-2222-4222-8222-222222222222",
  email: "search-source@example.test",
  deviceState: "trusted" as const,
};
const leased = new Set<SearchLease>();
const handles = new Set<{ close(): void }>();
beforeAll(async () =>
  initSync({
    module: await readFile(
      new URL("../../src/generated/wasm/orbyn_wasm_bg.wasm", import.meta.url),
    ),
  }),
);
afterEach(() => {
  for (const lease of leased) {
    try {
      releaseSearchSource(lease);
    } catch {
      /* Already revoked. */
    }
  }
  leased.clear();
  for (const handle of handles) handle.close();
  handles.clear();
  vi.restoreAllMocks();
  lock();
});
function sameBytes(a: Uint8Array, b: Uint8Array) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
it.each([
  { name: "small", count: 3, chars: 256 },
  { name: "medium", count: 100, chars: 8192 },
])(
  "measures genuine owner baseline and sealed-proof read work for $name",
  async (profile) => {
    lock();
    vi.stubGlobal("indexedDB", new IDBFactory());
    const wrapKey = await newWrappingKey(),
      secret = await wrappingSecret(wrapKey),
      keys = DeviceKeys.create(),
      engine = SyncEngine.create(keys, identity.accountId, identity.deviceId),
      at = new Date().toISOString();
    try {
      engine.createZoneKey("notes-local");
      engine.stage(
        "notes-local",
        "notes_library",
        "library",
        JSON.stringify({
          notes: {
            stamp: JSON.parse(engine.tick(Date.now())),
            value: Array.from({ length: profile.count }, (_, i) => ({
              id: "synthetic-note-" + i,
              title: "Synthetic " + i,
              document: {
                type: "doc",
                content: [
                  {
                    type: "paragraph",
                    content: [
                      { type: "text", text: "x".repeat(profile.chars) },
                    ],
                  },
                ],
              },
              tags: [],
              createdAt: at,
              updatedAt: at,
              trashedAt: null,
              revision: 1,
            })),
          },
        }),
      );
      await mutateRecord<DeviceRecord>("devices", identity.email, () => ({
        ...identity,
        wrapKey,
        sealedKeys: keys.export(secret),
        snapshot: engine.snapshot(secret),
        generation: 0,
        verifiedTrust: true,
      }));
    } finally {
      engine.free();
      keys.free();
      secret.fill(0);
    }
    establish(identity);
    let started = performance.now();
    const notes = await openNotesStore(identity);
    handles.add(notes);
    const collections = await openCollectionsStore(identity);
    handles.add(collections);
    const openMs = performance.now() - started,
      restore = vi.spyOn(SyncEngine, "restore");
    started = performance.now();
    for (let i = 0; i < 3; i++) {
      await notes.list();
      await collections.read();
    }
    const ownerReadsMs = performance.now() - started;
    expect(restore).toHaveBeenCalledTimes(6);
    const original = (await readRecord<DeviceRecord>(
      "devices",
      identity.email,
    ))!;
    started = performance.now();
    for (let i = 0; i < 3; i++) {
      const current = (await readRecord<DeviceRecord>(
        "devices",
        identity.email,
      ))!;
      const left = await wrappingSecret(original.wrapKey),
        right = await wrappingSecret(current.wrapKey);
      try {
        expect(sameBytes(left, right)).toBe(true);
        expect(sameBytes(original.sealedKeys, current.sealedKeys)).toBe(true);
        expect(sameBytes(original.snapshot!, current.snapshot!)).toBe(true);
      } finally {
        left.fill(0);
        right.fill(0);
      }
    }
    const proofReadsMs = performance.now() - started;
    expect(restore).toHaveBeenCalledTimes(6);
    process.stdout.write(
      "search-source-baseline " +
        JSON.stringify({
          profile: profile.name,
          notes: profile.count,
          snapshotBytes: original.snapshot!.length,
          ownerOpenMs: Number(openMs.toFixed(2)),
          threeOwnerPairsMs: Number(ownerReadsMs.toFixed(2)),
          ownerPairRestoreCount: restore.mock.calls.length,
          threeRecordAndProofChecksMs: Number(proofReadsMs.toFixed(2)),
          proofExtraRestores: 0,
        }) +
        "\n",
    );
  },
);

async function fixture(journal = false) {
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
  const notes = await openNotesStore(identity),
    collections = await openCollectionsStore(identity);
  handles.add(notes);
  handles.add(collections);
  const note = await notes.create({
    title: "ACTIVE",
    document: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "ORIGINAL BODY" }],
        },
      ],
    },
    tags: ["real-tag"],
  });
  const trash = await notes.create({
    title: "TRASH HIDDEN",
    document: { type: "doc", content: [] },
    tags: [],
  });
  await notes.trash(trash.id, 1);
  const before = await collections.read(),
    at = new Date();
  let callbackInput: any, callbackOutput: any;
  await collections.update(before, (current) => {
    callbackInput = current;
    let study = createDeck(current.study, "Real deck", at);
    const deckId = study.decks[0]!.id;
    for (const type of ["basic", "reversed", "cloze"] as const) {
      const base = {
        id: crypto.randomUUID(),
        deckId,
        revision: 1,
        tags: ["entry-tag"],
        source: {
          noteId: note.id,
          noteRevision: note.revision,
          quote: "HIDDEN-SOURCE-QUOTE",
        },
      };
      study = saveEntry(
        study,
        type === "cloze"
          ? {
              ...base,
              type,
              text: "Fill {{one}} and {{two}}",
              blanks: [
                { id: "one", answer: "FIRST" },
                { id: "two", answer: "SECOND" },
              ],
            }
          : { ...base, type, front: "FRONT-" + type, back: "BACK-" + type },
        at,
      );
    }
    callbackOutput = {
      ...current,
      study,
      clips: {
        ...current.clips,
        items: [
          {
            id: crypto.randomUUID(),
            revision: 1,
            title: "Saved archive",
            originalUrl: "https://example.test/saved",
            canonicalUrl: "https://example.test/saved",
            text: "SAVED TEXT",
            createdAt: at.toISOString(),
            updatedAt: at.toISOString(),
            readAt: null,
            readLater: false,
            archivedAt: at.toISOString(),
          },
        ],
      },
    };
    return callbackOutput;
  });
  if (journal) {
    const current = await collections.read(),
      data = emptyJournal();
    data.habits.push({
      id: crypto.randomUUID(),
      name: "HIDDEN-JOURNAL-TEXT",
      order: 0,
      createdAt: at.toISOString(),
      createdOn: at.toISOString().slice(0, 10),
      archivedAt: null,
      archivedOn: null,
      revision: 1,
    });
    const sealed = await createJournalEnvelope(
      "synthetic private passphrase",
      data,
      { accountId: identity.accountId, epoch: current.epoch },
      () => {},
    );
    await replaceJournal(collections, current, sealed.envelope);
  }
  // Synchronize genuine private owner captures to the same current encrypted image.
  await notes.list();
  await collections.read();
  return { notes, collections, note, callbackInput, callbackOutput };
}
async function leaseOf(f: Awaited<ReturnType<typeof fixture>>) {
  const lease = await acquireSearchSource(
    protectOperations(f.notes, ["create", "update", "erase"]),
    f.collections,
  );
  leased.add(lease);
  return lease;
}
function body(reader: ReturnType<typeof searchSourceReader>) {
  const root = reader.note(0).root;
  return reader.node(reader.child(reader.child(root, 0), 0)).text;
}
it("genuine immutable lease exposes only whitelisted actual entities and never opens Journal", async () => {
  const f = await fixture(true),
    restore = vi.spyOn(SyncEngine, "restore"),
    decrypt = vi.spyOn(crypto.subtle, "decrypt"),
    lease = await leaseOf(f),
    reader = searchSourceReader(lease);
  expect(reader.counts).toEqual({
    notes: 1,
    clips: 1,
    decks: 1,
    entries: 3,
    cards: 5,
  });
  expect(reader.versions.library.epoch).not.toBe(
    reader.versions.collections.epoch,
  );
  expect(reader.clip(0).archivedAt).not.toBeNull();
  expect(body(reader)).toBe("ORIGINAL BODY");
  const cloze = reader.entry(2);
  if (cloze.type !== "cloze") throw new Error("fixture");
  expect(reader.blank(cloze.cursor, 0)).toEqual({ id: "one", answer: "FIRST" });
  expect(reader.card(4).key).toBe("cloze:two");
  const exposed = JSON.stringify([
    reader.counts,
    reader.note(0),
    reader.clip(0),
    reader.deck(0),
    reader.entry(0),
    reader.entry(1),
    cloze,
    reader.card(0),
  ]);
  expect(exposed).not.toMatch(
    /HIDDEN-JOURNAL|HIDDEN-SOURCE|schedule|events|ciphertext/,
  );
  expect(decrypt).not.toHaveBeenCalled();
  expect(restore).not.toHaveBeenCalled();
  expect(Object.isFrozen(lease)).toBe(true);
  expect(Object.isFrozen(reader.note(0).tags)).toBe(true);
  expect(() => {
    (reader.note(0).tags as string[]).push("forged");
  }).toThrow();
  expect(() => {
    (reader.node(reader.note(0).root) as any).text = "forged";
  }).toThrow();
  await expect(
    assertSearchSourceFresh({} as SearchLease),
  ).rejects.toMatchObject({ code: "search_source_invalid" });
  await expect(
    acquireSearchSource({ library: {} } as any, f.collections),
  ).rejects.toThrow();
});
it("escaped owner DTOs and retained mutator inputs/outputs cannot mutate private source backing", async () => {
  const f = await fixture(),
    lease = await leaseOf(f),
    reader = searchSourceReader(lease),
    invalidated = vi.fn();
  onSearchSourceInvalidated(lease, invalidated);
  const listed = await f.notes.list(),
    got = await f.notes.get(f.note.id),
    linked = await noteLinkOwner(f.notes).read(),
    sourced = await studySourceOwner(f.notes).read(),
    col = await f.collections.read();
  listed[0]!.document.content[0]!.content![0]!.text = "LIST ALIAS";
  got!.tags.push("GET ALIAS");
  linked.notes[0]!.title = "LINK ALIAS";
  sourced.notes[0]!.document.content = [];
  sourced.collections.study.entries[0]!.tags.push("SOURCE ALIAS");
  col.study.entries[2]!.type = "basic" as any;
  f.callbackInput.study.preferences.timezone = "bad";
  f.callbackOutput.study.entries[0].tags.push("CALLBACK ALIAS");
  f.callbackOutput.study.entries[2].blanks[0].answer = "CALLBACK ANSWER";
  const restore = vi.spyOn(SyncEngine, "restore");
  await assertSearchSourceFresh(lease);
  expect(restore).not.toHaveBeenCalled();
  expect(invalidated).not.toHaveBeenCalled();
  expect(reader.note(0).title).toBe("ACTIVE");
  expect(reader.note(0).tags).toEqual(["real-tag"]);
  expect(body(reader)).toBe("ORIGINAL BODY");
  expect(reader.entry(0).tags).toEqual(["entry-tag"]);
  const entry = reader.entry(2);
  if (entry.type !== "cloze") throw new Error("fixture");
  expect(reader.blank(entry.cursor, 0).answer).toBe("FIRST");
});
it("repeated lease admission and freshness checks reuse genuine loaded projections with zero restores", async () => {
  const f = await fixture(),
    restore = vi.spyOn(SyncEngine, "restore");
  for (let i = 0; i < 5; i++) {
    const lease = await leaseOf(f);
    await assertSearchSourceFresh(lease);
    expect(searchSourceReader(lease).counts.cards).toBe(5);
    releaseSearchSource(lease);
  }
  expect(restore).not.toHaveBeenCalled();
});
it("local committed changes invalidate before ordinary observers while same-proof refresh preserves leases", async () => {
  const f = await fixture(),
    lease = await leaseOf(f),
    order: string[] = [];
  onSearchSourceInvalidated(lease, (reason) => order.push(reason));
  const stop = f.notes.subscribe(() => {
    if (f.notes.persistence().status === "ready") order.push("ordinary");
  });
  await f.notes.update(f.note.id, { title: "Changed" }, 1);
  stop();
  expect(order).toEqual(["changed", "ordinary"]);
  expect(() => searchSourceReader(lease)).toThrow(
    expect.objectContaining({ code: "search_source_changed" }),
  );
});
it("quota rollback cannot publish attempted cache data or invalidate a genuine unchanged lease", async () => {
  const f = await fixture(),
    lease = await leaseOf(f),
    reader = searchSourceReader(lease),
    invalidated = vi.fn();
  onSearchSourceInvalidated(lease, invalidated);
  vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(() => {
    throw new DOMException("full", "QuotaExceededError");
  });
  await expect(
    f.notes.update(f.note.id, { title: "NOT COMMITTED" }, 1),
  ).rejects.toThrow();
  vi.restoreAllMocks();
  await assertSearchSourceFresh(lease);
  expect(reader.note(0).title).toBe("ACTIVE");
  expect(invalidated).not.toHaveBeenCalled();
});

async function externalImageChange(effect: (engine: SyncEngine) => void) {
  const record = (await readRecord<DeviceRecord>("devices", identity.email))!,
    secret = await wrappingSecret(record.wrapKey),
    keys = DeviceKeys.import(record.sealedKeys, secret),
    engine = SyncEngine.restore(keys, record.snapshot!, secret, Date.now());
  try {
    effect(engine);
    await mutateRecord<DeviceRecord>("devices", identity.email, (current) => ({
      ...current!,
      snapshot: engine.snapshot(secret),
    }));
  } finally {
    engine.free();
    keys.free();
    secret.fill(0);
  }
}
it.each(["notes", "collections"])(
  "same-generation %s tamper revokes without restore and explicit concurrent admission loads each owner once",
  async (kind) => {
    const f = await fixture(),
      lease = await leaseOf(f),
      reader = searchSourceReader(lease),
      notice = vi.fn();
    onSearchSourceInvalidated(lease, notice);
    const token = reader.versions;
    await externalImageChange((engine) => {
      if (kind === "notes") {
        const raw = JSON.parse(engine.record("notes-local", "library")!);
        raw.fields.notes.value.find(
          (note: any) => note.id === f.note.id,
        ).title = "EXTERNAL";
        raw.fields.notes.stamp = JSON.parse(engine.tick(Date.now()));
        engine.stage(
          "notes-local",
          "notes_library",
          "library",
          JSON.stringify(raw.fields),
        );
      } else {
        const raw = JSON.parse(
          engine.record("notes-collections-v1", "workspace")!,
        );
        raw.fields.collections.value.clips.items[0].title = "EXTERNAL";
        raw.fields.collections.stamp = JSON.parse(engine.tick(Date.now()));
        engine.stage(
          "notes-collections-v1",
          "notes_collections",
          "workspace",
          JSON.stringify(raw.fields),
        );
      }
    });
    const restore = vi.spyOn(SyncEngine, "restore");
    await expect(assertSearchSourceFresh(lease)).rejects.toMatchObject({
      code: "search_source_revoked",
    });
    expect(restore).not.toHaveBeenCalled();
    expect(notice).toHaveBeenCalledWith("unverified");
    expect(() => reader.note(0)).toThrow();
    const newer = await Promise.all([leaseOf(f), leaseOf(f), leaseOf(f)]);
    expect(restore).toHaveBeenCalledTimes(2);
    for (const next of newer) {
      const value = searchSourceReader(next);
      expect(value.versions).toEqual(token);
      expect(kind === "notes" ? value.note(0).title : value.clip(0).title).toBe(
        "EXTERNAL",
      );
    }
    await expect(assertSearchSourceFresh(lease)).rejects.toMatchObject({
      code: "search_source_revoked",
    });
  },
);
it("accepts cloned key wrappers but rejects different wrapping material without an engine read", async () => {
  const f = await fixture(),
    lease = await leaseOf(f),
    first = (await readRecord<DeviceRecord>("devices", identity.email))!,
    second = (await readRecord<DeviceRecord>("devices", identity.email))!;
  expect(first.wrapKey).not.toBe(second.wrapKey);
  await assertSearchSourceFresh(lease);
  const key = await newWrappingKey();
  await mutateRecord<DeviceRecord>("devices", identity.email, (record) => ({
    ...record!,
    wrapKey: key,
  }));
  const restore = vi.spyOn(SyncEngine, "restore"),
    notice = vi.fn();
  onSearchSourceInvalidated(lease, notice);
  await expect(assertSearchSourceFresh(lease)).rejects.toMatchObject({
    code: "search_source_revoked",
  });
  expect(notice).toHaveBeenCalledWith("unverified");
  await expect(leaseOf(f)).rejects.toMatchObject({
    code: "search_source_revoked",
  });
  expect(restore).not.toHaveBeenCalled();
});
it("zeroes both existing wrappingSecret outputs after every proof verification", async () => {
  const f = await fixture(),
    lease = await leaseOf(f),
    buffers: ArrayBuffer[] = [];
  const real = crypto.subtle.sign.bind(crypto.subtle);
  vi.spyOn(crypto.subtle, "sign").mockImplementation(async (...args) => {
    const result = await real(...args);
    buffers.push(result);
    return result;
  });
  await assertSearchSourceFresh(lease);
  expect(buffers).toHaveLength(4);
  expect(
    buffers.every((buffer) =>
      new Uint8Array(buffer).every((byte) => byte === 0),
    ),
  ).toBe(true);
});
it("account lock, same-ID reauth, owner close and release revoke retained cursors", async () => {
  for (const action of ["release", "close", "reauth", "lock"]) {
    const f = await fixture(),
      lease = await leaseOf(f),
      reader = searchSourceReader(lease),
      node = reader.note(0).root,
      entry = reader.entry(2),
      notice = vi.fn();
    onSearchSourceInvalidated(lease, notice);
    if (action === "release") releaseSearchSource(lease);
    else if (action === "close") f.collections.close();
    else if (action === "reauth") establish(identity);
    else lock();
    expect(notice).toHaveBeenCalled();
    expect(() => reader.node(node)).toThrow();
    if (entry.type === "cloze")
      expect(() => reader.blank(entry.cursor, 0)).toThrow();
  }
});
it("own erase reports epoch revocation before ordinary observers and preserves independent fresh epochs", async () => {
  const f = await fixture(),
    lease = await leaseOf(f),
    old = searchSourceReader(lease).versions,
    order: string[] = [];
  onSearchSourceInvalidated(lease, (reason) => order.push(reason));
  const stop = f.notes.subscribe(() => {
    if (f.notes.persistence().status === "ready") order.push("ordinary");
  });
  await f.notes.erase();
  stop();
  expect(order[0]).toBe("epoch");
  expect(order[1]).toBe("ordinary");
  await expect(assertSearchSourceFresh(lease)).rejects.toMatchObject({
    code: "search_source_revoked",
  });
  const next = await leaseOf(f),
    reader = searchSourceReader(next);
  expect(reader.versions.library.epoch).not.toBe(old.library.epoch);
  expect(reader.versions.collections.epoch).not.toBe(old.collections.epoch);
  expect(reader.counts).toEqual({
    notes: 0,
    clips: 0,
    decks: 0,
    entries: 0,
    cards: 0,
  });
});
it("aborted proof work cannot grant or publish a late lease", async () => {
  const f = await fixture(),
    abort = new AbortController();
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>((resolve) => (entered = resolve)),
    barrier = new Promise<void>((resolve) => (release = resolve)),
    real = crypto.subtle.sign.bind(crypto.subtle);
  let first = true;
  vi.spyOn(crypto.subtle, "sign").mockImplementation(async (...args) => {
    if (first) {
      first = false;
      entered();
      await barrier;
    }
    return real(...args);
  });
  const pending = acquireSearchSource(f.notes, f.collections, abort.signal);
  await started;
  abort.abort();
  release();
  await expect(pending).rejects.toMatchObject({
    code: "search_source_revoked",
  });
});

it("corrupt changed images are never zero categories and do not repeat admission restores", async () => {
  const f = await fixture(),
    lease = await leaseOf(f);
  await externalImageChange((engine) => {
    const raw = JSON.parse(engine.record("notes-collections-v1", "workspace")!);
    raw.fields.collections.value.study.cards[0].entryId = crypto.randomUUID();
    raw.fields.collections.stamp = JSON.parse(engine.tick(Date.now()));
    engine.stage(
      "notes-collections-v1",
      "notes_collections",
      "workspace",
      JSON.stringify(raw.fields),
    );
  });
  const restore = vi.spyOn(SyncEngine, "restore");
  await expect(assertSearchSourceFresh(lease)).rejects.toThrow();
  expect(restore).not.toHaveBeenCalled();
  await expect(leaseOf(f)).rejects.toThrow();
  const first = restore.mock.calls.length;
  expect(first).toBe(2);
  await expect(leaseOf(f)).rejects.toThrow();
  expect(restore).toHaveBeenCalledTimes(first);
});
it("different sealed device userdata revokes instead of silently reusing admission", async () => {
  const f = await fixture(),
    lease = await leaseOf(f),
    record = (await readRecord<DeviceRecord>("devices", identity.email))!,
    secret = await wrappingSecret(record.wrapKey),
    different = DeviceKeys.create();
  try {
    const sealed = different.export(secret);
    await mutateRecord<DeviceRecord>("devices", identity.email, (current) => ({
      ...current!,
      sealedKeys: sealed,
    }));
  } finally {
    different.free();
    secret.fill(0);
  }
  const restore = vi.spyOn(SyncEngine, "restore");
  await expect(assertSearchSourceFresh(lease)).rejects.toMatchObject({
    code: "search_source_revoked",
  });
  await expect(leaseOf(f)).rejects.toMatchObject({
    code: "search_source_revoked",
  });
  expect(restore).not.toHaveBeenCalled();
});
it.each([1, 2, 3, 4, 5, 6, 7, 8])(
  "a source-pair mutation at proof sign %i cannot expose stale data",
  async (pauseAt) => {
    const f = await fixture();
    const held = await leaseOf(f),
      oldReader = searchSourceReader(held),
      oldEpochs = oldReader.versions,
      oldNode = oldReader.note(0).root;
    let entered!: () => void, release!: () => void;
    const started = new Promise<void>((resolve) => (entered = resolve)),
      barrier = new Promise<void>((resolve) => (release = resolve)),
      real = crypto.subtle.sign.bind(crypto.subtle);
    let calls = 0;
    vi.spyOn(crypto.subtle, "sign").mockImplementation(async (...args) => {
      if (++calls === pauseAt) {
        entered();
        await barrier;
      }
      return real(...args);
    });
    // Both captures and the final pair freshness check verify two wrapping keys.
    // Pause each of those eight signs without depending on which owner runs first.
    const pending = acquireSearchSource(f.notes, f.collections).then(
      (lease) => ({ status: "fulfilled" as const, lease }),
      (error: unknown) => ({ status: "rejected" as const, error }),
    );
    await started;
    try {
      await f.notes.erase();
    } finally {
      release();
    }
    expect(() => oldReader.node(oldNode)).toThrow(SearchSourceError);
    const result = await pending;
    if (result.status === "rejected") {
      expect(result.error).toBeInstanceOf(SearchSourceError);
      expect([
        "search_source_changed",
        "search_source_revoked",
        "search_source_unavailable",
      ]).toContain((result.error as SearchSourceError).code);
    } else {
      // Capture may re-admit the committed new image before it creates a Part.
      // Success is safe only if the genuine lease has no pre-erase content.
      leased.add(result.lease);
      await assertSearchSourceFresh(result.lease);
      const reader = searchSourceReader(result.lease);
      expect(reader.versions.library.epoch).not.toBe(oldEpochs.library.epoch);
      expect(reader.versions.collections.epoch).not.toBe(
        oldEpochs.collections.epoch,
      );
      expect(reader.counts).toEqual({
        notes: 0,
        clips: 0,
        decks: 0,
        entries: 0,
        cards: 0,
      });
      expect(() => reader.node(oldNode)).toThrow(SearchSourceError);
    }
  },
);
it("measures scalar whitelist capture on the real maximum entity-count producer profile", async () => {
  const f = await fixture(),
    current = await f.collections.read(),
    at = new Date(),
    deckId = current.study.decks[0]!.id;
  // Build the valid entry/card relationship together in one real owner commit.
  const base = await f.collections.read();
  await f.collections.update(base, (state) => {
    const entries = Array.from({ length: 10000 }, (_, i) => ({
      id: crypto.randomUUID(),
      deckId,
      revision: 1,
      tags: [],
      source: null,
      type: "reversed" as const,
      front: "Question " + i,
      back: "Answer " + i,
    }));
    return {
      ...state,
      study: {
        ...state.study,
        entries,
        cards: entries.flatMap((entry) =>
          ["reversed:forward", "reversed:reverse"].map((key) => ({
            id: crypto.randomUUID(),
            entryId: entry.id,
            key: key as "reversed:forward" | "reversed:reverse",
            revision: 1,
            schedule: initialSchedule(at),
          })),
        ),
      },
      clips: {
        items: Array.from({ length: 5000 }, (_, i) => ({
          id: crypto.randomUUID(),
          revision: 1,
          title: "Clip " + i,
          originalUrl: "https://example.test/" + i,
          canonicalUrl: "https://example.test/" + i,
          text: null,
          createdAt: at.toISOString(),
          updatedAt: at.toISOString(),
          readAt: null,
          readLater: false,
          archivedAt: null,
        })),
        receipts: [],
      },
    };
  });
  const notes = await f.notes.list(),
    col = await f.collections.read(),
    library = await f.notes.library.read();
  if (library.mode !== "ready") throw new Error("fixture");
  let started = performance.now();
  const left = notesSearchData(notes, library.snapshot.token),
    right = collectionsSearchData(col),
    projectionMs = performance.now() - started;
  expect(left.notes).toHaveLength(1);
  expect(right.entries).toHaveLength(10000);
  expect(right.cards).toHaveLength(20000);
  expect(right.clips).toHaveLength(5000);
  expect(Object.hasOwn(right, "journal")).toBe(false);
  expect(Object.hasOwn(right.entries[0]!, "source")).toBe(false);
  expect(Object.hasOwn(right.cards[0]!, "schedule")).toBe(false);
  const restore = vi.spyOn(SyncEngine, "restore");
  started = performance.now();
  const lease = await leaseOf(f);
  await assertSearchSourceFresh(lease);
  const leaseMs = performance.now() - started;
  expect(restore).not.toHaveBeenCalled();
  expect(searchSourceReader(lease).counts.cards).toBe(20000);
  process.stdout.write(
    "search-source-structural " +
      JSON.stringify({
        entries: 10000,
        cards: 20000,
        clips: 5000,
        scalarProjectionMs: Number(projectionMs.toFixed(2)),
        leaseAndFreshnessMs: Number(leaseMs.toFixed(2)),
        extraRestores: 0,
        snapshotBytes: (await readRecord<DeviceRecord>(
          "devices",
          identity.email,
        ))!.snapshot!.length,
      }) +
      "\n",
  );
}, 15000);

it("unknown cross-owner notifications revoke before ordinary Notes observers", async () => {
  const original = globalThis.BroadcastChannel;
  const channels: EventTarget[] = [];
  class Channel extends EventTarget {
    constructor(_name: string) {
      super();
      channels.push(this);
    }
    close() {}
    postMessage(_value: unknown) {}
  }
  vi.stubGlobal("BroadcastChannel", Channel);
  try {
    const f = await fixture(),
      lease = await leaseOf(f),
      order: string[] = [];
    onSearchSourceInvalidated(lease, (reason) => order.push(reason));
    const stop = f.notes.subscribe(() => order.push("observer"));
    const restore = vi.spyOn(SyncEngine, "restore");
    channels[0]!.dispatchEvent(new Event("message"));
    expect(order).toEqual(["unverified", "observer"]);
    expect(() => searchSourceReader(lease)).toThrow();
    expect(restore).not.toHaveBeenCalled();
    stop();
  } finally {
    vi.stubGlobal("BroadcastChannel", original);
  }
});

it("a failed optional post-commit key proof revokes before committed-write observers", async () => {
  const f = await fixture(),
    lease = await leaseOf(f),
    order: string[] = [];
  onSearchSourceInvalidated(lease, (reason) => order.push(reason));
  const stop = f.notes.subscribe(() => {
    if (f.notes.persistence().status === "ready") order.push("observer");
  });
  const sign = crypto.subtle.sign.bind(crypto.subtle);
  vi.spyOn(crypto.subtle, "sign")
    .mockImplementationOnce((...args) => sign(...args))
    .mockRejectedValueOnce(new Error("synthetic proof failure"));
  const updated = await f.notes.update(
    f.note.id,
    {
      title: "Committed despite optional cache failure",
      document: f.note.document,
      tags: f.note.tags,
    },
    f.note.revision,
  );
  expect(updated.title).toBe("Committed despite optional cache failure");
  expect(order).toEqual(["unverified", "observer"]);
  expect(() => searchSourceReader(lease)).toThrow();
  stop();
});
