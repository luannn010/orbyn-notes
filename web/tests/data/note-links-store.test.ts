import { protectOperations } from "../../src/desktop/closeGuard";
// @vitest-environment node
import { beforeAll, beforeEach, afterEach, it, expect, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import {
  initSync,
  DeviceKeys,
  SyncEngine,
} from "../../src/generated/wasm/orbyn_wasm.js";
import { establish, lock } from "../../src/account/session";
import {
  newWrappingKey,
  wrappingSecret,
  mutateRecord,
  readRecord,
} from "../../src/data/database";
import type { DeviceRecord } from "../../src/data/database";
import { openNotesStore } from "../../src/data";
import type { NoteDocument } from "../../src/domain/contracts";
import { createNoteLinkService } from "../../src/links/store";
import { noteLinkOwner } from "../../src/library/store";
const identity = {
  accountId: "11111111-1111-4111-8111-111111111111",
  deviceId: "22222222-2222-4222-8222-222222222222",
  email: "links@example.test",
  deviceState: "trusted" as const,
};
const handles = new Set<{ close(): void }>();
const document: NoteDocument = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [{ type: "text", text: "Before alpha beta After alpha beta" }],
    },
  ],
};
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
  for (const handle of handles) handle.close();
  handles.clear();
  vi.restoreAllMocks();
  vi.useRealTimers();
  lock();
});

async function setup() {
  const notes = await openNotesStore(identity);
  handles.add(notes);
  const a = await notes.create({ title: "Alpha", document, tags: [] });
  const b = await notes.create({ title: "Beta", document, tags: [] });
  const links = createNoteLinkService(notes);
  handles.add(links);
  return { notes, links, a, b };
}
function linked(target: unknown): NoteDocument {
  return {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          { type: "text", text: "Link " },
          { type: "noteLink", attrs: { version: 1, target } },
        ],
      },
    ],
  };
}
async function mutateLibrary(change: (state: any, engine: SyncEngine) => void) {
  const record = (await readRecord<DeviceRecord>("devices", identity.email))!,
    secret = await wrappingSecret(record.wrapKey),
    keys = DeviceKeys.import(record.sealedKeys, secret),
    engine = SyncEngine.restore(keys, record.snapshot!, secret, Date.now());
  try {
    const raw = JSON.parse(engine.record("notes-library-v1", "workspace")!),
      value = raw.fields.library.value;
    change(value, engine);
    engine.stage(
      "notes-library-v1",
      "notes_library_metadata",
      "workspace",
      JSON.stringify({
        library: { value, stamp: JSON.parse(engine.tick(Date.now())) },
      }),
    );
    await mutateRecord<DeviceRecord>("devices", identity.email, (current) => ({
      ...current!,
      snapshot: engine.snapshot(secret),
      generation: current!.generation + 1,
    }));
  } finally {
    engine.free();
    keys.free();
    secret.fill(0);
  }
}
it("keeps strict2 editing and refuses new atoms until complete legacy premise", async () => {
  const { notes, links, a, b } = await setup();
  const state = await noteLinkOwner(notes).read();
  expect(state.library.version).toBe(2);
  expect((await links.linkedNoteIds()).status).toBe("pending");
  await expect(links.reference(b.id)).rejects.toMatchObject({
    code: "note_link_migration_pending",
  });
  const target = {
    kind: "note",
    accountId: identity.accountId,
    libraryEpoch: state.library.epoch,
    noteId: b.id,
  };
  await expect(
    notes.update(a.id, { document: linked(target) }, a.revision),
  ).rejects.toThrow();
  const edited = await notes.update(
    a.id,
    { title: "Still editable" },
    a.revision,
  );
  expect((await noteLinkOwner(notes).read()).library.version).toBe(2);
  expect((await links.verifyGraph()).status).toBe("ready");
  const reference = await links.reference(b.id);
  await notes.update(
    a.id,
    { document: linked(reference.target) },
    edited.revision,
  );
  const current = await noteLinkOwner(notes).read();
  expect(current.library.version).toBe(3);
  expect(current.index.status).toBe("valid");
  expect((await links.backlinks(b.id)).status).toBe("pending");
  await links.verifyGraph();
  expect(await links.backlinks(b.id)).toMatchObject({
    status: "ready",
    items: [{ sourceId: a.id, occurrences: 1, title: "Still editable" }],
  });
});
it("isolates malformed index, blocks writers and repairs once with durable replay", async () => {
  const { notes, links, a } = await setup();
  await links.verifyGraph();
  await notes.update(a.id, { title: "Admit3" }, a.revision);
  await mutateLibrary((state) => {
    state.noteLinks = { bad: true };
  });
  const other = await openNotesStore(identity);
  handles.add(other);
  const service = createNoteLinkService(other);
  handles.add(service);
  expect(await service.admission()).toMatchObject({
    mode: "index-recovery",
    reason: "index-invalid",
  });
  const before = (await readRecord<DeviceRecord>("devices", identity.email))!;
  await expect(
    other.update(a.id, { title: "blocked" }, a.revision + 1),
  ).rejects.toMatchObject({ code: "note_link_index_invalid" });
  expect(
    (await readRecord<DeviceRecord>("devices", identity.email))!.snapshot,
  ).toEqual(before.snapshot);
  expect((await service.verifyGraph()).status).toBe("invalid");
  const intent = await service.prepareRepair(await service.currentToken());
  const result = await service.commitRepair(intent);
  expect(result.replayed).toBe(false);
  expect((await service.commitRepair(intent)).replayed).toBe(true);
  expect(
    (await readRecord<DeviceRecord>("devices", identity.email))!.generation,
  ).toBe(before.generation + 1);
  expect((await service.verifyGraph()).status).toBe("ready");
});
it("detects plausible false rows and quarantines the genuine owner before mutation", async () => {
  const { notes, links, a, b } = await setup();
  await links.verifyGraph();
  await notes.update(
    a.id,
    { document: linked((await links.reference(b.id)).target) },
    1,
  );
  await mutateLibrary((state) => {
    state.noteLinks = [];
  });
  expect(await links.verifyGraph()).toMatchObject({
    status: "invalid",
    code: "index-mismatch",
  });
  await expect(
    notes.library.setSort(
      "title",
      await links.currentToken(),
      crypto.randomUUID(),
    ),
  ).rejects.toMatchObject({ code: "note_link_index_invalid" });
  const repair = await links.prepareRepair(await links.currentToken());
  await links.commitRepair(repair);
  await links.verifyGraph();
  expect(await links.backlinks(b.id)).toMatchObject({
    status: "ready",
    items: [{ sourceId: a.id }],
  });
});
it("revokes prepared migration/repair work across erase and same-account reauth", async () => {
  const { notes, links, a } = await setup();
  await links.verifyGraph();
  await notes.erase();
  await expect(links.reference(a.id)).rejects.toMatchObject({
    code: "note_link_revoked",
  });
  const current = createNoteLinkService(notes);
  handles.add(current);
  await current.verifyGraph();
  establish(identity);
  await expect(current.currentToken()).rejects.toMatchObject({
    code: "note_link_revoked",
  });
});
it("rolls back graph/document/history together on quota error", async () => {
  const { notes, links, a, b } = await setup();
  await links.verifyGraph();
  const ref = await links.reference(b.id),
    before = (await readRecord<DeviceRecord>("devices", identity.email))!;
  vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(() => {
    throw new DOMException("full", "QuotaExceededError");
  });
  await expect(
    notes.update(a.id, { document: linked(ref.target) }, a.revision),
  ).rejects.toThrow();
  vi.restoreAllMocks();
  const after = (await readRecord<DeviceRecord>("devices", identity.email))!;
  expect(after.generation).toBe(before.generation);
  expect(after.snapshot).toEqual(before.snapshot);
});

it("resumes bounded legacy verification without fake ready or blocked ordinary editing", async () => {
  const { notes, links, a } = await setup(),
    now = new Date().toISOString();
  const huge = Array.from({ length: 12 }, (_, i) => ({
    ...a,
    id: "large-" + i,
    title: "Large " + i,
    document: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "x".repeat(1000000) }],
        },
      ],
    },
  }));
  await mutateLibrary((state, engine) => {
    state.noteMetadata = huge.map((note) => ({
      noteId: note.id,
      revision: 1,
      pinned: false,
      tagIds: [],
    }));
    engine.stage(
      "notes-local",
      "notes_library",
      "library",
      JSON.stringify({
        notes: { value: huge, stamp: JSON.parse(engine.tick(Date.now())) },
      }),
    );
  });
  const before = (await readRecord<DeviceRecord>("devices", identity.email))!;
  const first = await links.verifyGraph();
  expect(first.status).toBe("paused-limit");
  if (first.status !== "paused-limit")
    throw new Error("expected bounded pause");
  expect(first.progress.verifiedNotes).toBeGreaterThan(0);
  expect(first.progress.verifiedNotes).toBeLessThan(12);
  expect(first.progress.utf8Units).toBeLessThanOrEqual(64 * 1024 * 1024);
  expect(first.progress.nodeVisits).toBeLessThanOrEqual(250000);
  expect((await links.linkedNoteIds()).status).toBe("paused-limit");
  await expect(links.reference(huge[0]!.id)).rejects.toMatchObject({
    code: "note_link_migration_pending",
  });
  expect(
    (await readRecord<DeviceRecord>("devices", identity.email))!.snapshot,
  ).toEqual(before.snapshot);
  expect((await links.verifyGraph()).status).toBe("ready");
  expect((await noteLinkOwner(notes).read()).library.version).toBe(2);
  const edited = await notes.update(
    huge[0]!.id,
    { title: "Actual complete migration" },
    1,
  );
  expect(edited.title).toBe("Actual complete migration");
  expect((await noteLinkOwner(notes).read()).library.version).toBe(3);
}, 15000);
it("bounds actual node visits and permits explicit continuation", async () => {
  const { notes, links, a } = await setup();
  const many = Array.from({ length: 50 }, (_, i) => ({
    ...a,
    id: "nodes-" + i,
    document: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: Array.from({ length: 3000 }, () => ({
            type: "text",
            text: "v",
          })),
        },
      ],
    },
  }));
  await mutateLibrary((state, engine) => {
    state.noteMetadata = many.map((note) => ({
      noteId: note.id,
      revision: 1,
      pinned: false,
      tagIds: [],
    }));
    engine.stage(
      "notes-local",
      "notes_library",
      "library",
      JSON.stringify({
        notes: { value: many, stamp: JSON.parse(engine.tick(Date.now())) },
      }),
    );
  });
  const first = await links.verifyGraph();
  expect(first.status).toBe("paused-limit");
  if (first.status !== "paused-limit") throw new Error("pause");
  expect(first.progress.nodeVisits).toBeLessThanOrEqual(250000);
  expect((await links.verifyGraph()).status).toBe("ready");
}, 15000);
it("does not publish after cancellation or account lock during async hashing", async () => {
  const { links } = await setup();
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  const real = crypto.subtle.digest.bind(crypto.subtle);
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  vi.spyOn(crypto.subtle, "digest").mockImplementation(async (...args) => {
    entered();
    await barrier;
    return real(...args);
  });
  const work = links.verifyGraph();
  await started;
  links.cancelVerification();
  release();
  await expect(work).rejects.toMatchObject({ code: "note_link_revoked" });
  vi.restoreAllMocks();
  expect((await links.linkedNoteIds()).status).not.toBe("ready");
  lock();
  await expect(links.verifyGraph()).rejects.toMatchObject({
    code: "note_link_revoked",
  });
});
it("unaware handles detect their changed-source mismatch without claiming global quarantine", async () => {
  const { notes, links, a, b } = await setup();
  await links.verifyGraph();
  await notes.update(
    a.id,
    { document: linked((await links.reference(b.id)).target) },
    1,
  );
  await mutateLibrary((state) => {
    state.noteLinks = [];
  });
  const other = await openNotesStore(identity);
  handles.add(other);
  const unaware = createNoteLinkService(other);
  handles.add(unaware);
  expect((await links.verifyGraph()).status).toBe("invalid");
  // Structural shape is valid; no persisted quarantine was invented by the first service.
  const metadata = await other.library.setSort(
    "title",
    await unaware.currentToken(),
    crypto.randomUUID(),
  );
  expect(metadata.snapshot.preferences.sort).toBe("title");
  const before = (await readRecord<DeviceRecord>("devices", identity.email))!;
  await expect(other.update(a.id, { document }, 2)).rejects.toMatchObject({
    code: "note_link_index_invalid",
  });
  expect(
    (await readRecord<DeviceRecord>("devices", identity.email))!.snapshot,
  ).toEqual(before.snapshot);
});

it("rejects stale repair CAS and quota without modifying the authenticated saved bytes", async () => {
  const { notes, links, a } = await setup();
  await links.verifyGraph();
  await notes.update(a.id, { title: "Admit" }, 1);
  await mutateLibrary((state) => {
    state.noteLinks = null;
  });
  await links.verifyGraph();
  const intent = await links.prepareRepair(await links.currentToken()),
    before = (await readRecord<DeviceRecord>("devices", identity.email))!;
  vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(() => {
    throw new DOMException("full", "QuotaExceededError");
  });
  await expect(links.commitRepair(intent)).rejects.toThrow();
  vi.restoreAllMocks();
  expect(
    (await readRecord<DeviceRecord>("devices", identity.email))!.snapshot,
  ).toEqual(before.snapshot);
  await mutateLibrary((state) => {
    state.revision++;
  });
  const latest = (await readRecord<DeviceRecord>("devices", identity.email))!;
  await expect(links.commitRepair(intent)).rejects.toMatchObject({
    code: "note_link_conflict",
  });
  expect(
    (await readRecord<DeviceRecord>("devices", identity.email))!.snapshot,
  ).toEqual(latest.snapshot);
});
it("preserves receipt replay after unrelated commit and fails closed after receipt pruning", async () => {
  const { notes, links, a } = await setup();
  await links.verifyGraph();
  await notes.update(a.id, { title: "Admit" }, 1);
  await mutateLibrary((state) => {
    state.noteLinks = null;
  });
  await links.verifyGraph();
  const intent = await links.prepareRepair(await links.currentToken());
  const first = await links.commitRepair(intent);
  const changed = await notes.update(a.id, { title: "Later unrelated" }, 2),
    before = (await readRecord<DeviceRecord>("devices", identity.email))!;
  const replay = await links.commitRepair(intent);
  expect(replay).toMatchObject({ ...first, replayed: true });
  expect(replay.committedToken.revision).toBeLessThan(
    (await links.currentToken()).revision,
  );
  expect(
    (await readRecord<DeviceRecord>("devices", identity.email))!.snapshot,
  ).toEqual(before.snapshot);
  await mutateLibrary((state) => {
    state.receipts = state.receipts.filter(
      (row: any) => row.id !== intent.operationId,
    );
  });
  const pruned = (await readRecord<DeviceRecord>("devices", identity.email))!;
  await expect(links.commitRepair(intent)).rejects.toMatchObject({
    code: "note_link_conflict",
  });
  expect(
    (await readRecord<DeviceRecord>("devices", identity.email))!.snapshot,
  ).toEqual(pruned.snapshot);
});
it("projects current authorized labels without storing them and handles Trash/restore/deletion", async () => {
  const { notes, links, a, b } = await setup();
  await links.verifyGraph();
  const target = (await links.reference(b.id)).target;
  await notes.update(
    a.id,
    {
      document: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "Actual source excerpt " },
              { type: "noteLink", attrs: { version: 1, target } },
              { type: "noteLink", attrs: { version: 1, target } },
            ],
          },
        ],
      },
    },
    1,
  );
  await links.verifyGraph();
  expect(await links.linkedNoteIds()).toMatchObject({
    status: "ready",
    items: expect.arrayContaining([a.id, b.id]),
  });
  expect(await links.backlinks(b.id)).toMatchObject({
    status: "ready",
    items: [
      {
        sourceId: a.id,
        occurrences: 2,
        snippet: "Actual source excerpt Note referenceNote reference",
      },
    ],
  });
  await notes.update(b.id, { title: "Renamed target" }, 1);
  expect(await links.resolve(target)).toMatchObject({
    status: "available",
    title: "Renamed target",
  });
  expect(JSON.stringify((await notes.get(a.id))!.document)).not.toContain(
    "Renamed target",
  );
  const trashed = await notes.trash(b.id, 2);
  expect(await links.resolve(target)).toEqual({
    status: "unavailable",
    reason: "trashed",
  });
  await notes.restore(b.id, trashed.revision);
  expect((await links.resolve(target)).status).toBe("available");
  const source = await notes.get(a.id);
  await notes.trash(a.id, source!.revision);
  await links.verifyGraph();
  expect(await links.backlinks(b.id)).toMatchObject({
    status: "ready",
    items: [],
  });
  const token = await links.currentToken();
  await notes.library.emptyTrash(token, crypto.randomUUID());
  expect((await noteLinkOwner(notes).read()).index).toMatchObject({
    status: "valid",
    rows: [],
  });
  expect(
    await links.resolve({
      ...target,
      accountId: "99999999-9999-4999-8999-999999999999",
    }),
  ).toEqual({ status: "unavailable", reason: "scope" });
});

it("verifies the full 10000-note/100000-reference graph with bounded rounds and linear row admission", async () => {
  const { notes, links, a } = await setup(),
    state = await noteLinkOwner(notes).read(),
    target = {
      kind: "note",
      accountId: identity.accountId,
      libraryEpoch: state.library.epoch,
      noteId: "scale-0",
    };
  const many = Array.from({ length: 10000 }, (_, i) => ({
    ...a,
    id: "scale-" + i,
    document: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: Array.from({ length: 10 }, () => ({
            type: "noteLink",
            attrs: { version: 1, target },
          })),
        },
      ],
    },
  }));
  await mutateLibrary((library, engine) => {
    library.version = 3;
    library.noteMetadata = many.map((note) => ({
      noteId: note.id,
      revision: 1,
      pinned: false,
      tagIds: [],
    }));
    library.noteLinks = many.map((note) => ({
      noteId: note.id,
      noteRevision: 1,
      targets: [{ target, occurrences: 10 }],
    }));
    engine.stage(
      "notes-local",
      "notes_library",
      "library",
      JSON.stringify({
        notes: { value: many, stamp: JSON.parse(engine.tick(Date.now())) },
      }),
    );
  });
  let rounds = 0,
    result;
  do {
    result = await links.verifyGraph();
    rounds++;
    if (result.status === "paused-limit") {
      expect(result.progress.utf8Units).toBeLessThanOrEqual(64 * 1024 * 1024);
      expect(result.progress.nodeVisits).toBeLessThanOrEqual(250000);
    }
  } while (result.status === "paused-limit" && rounds < 8);
  expect(result.status).toBe("ready");
  expect(rounds).toBeGreaterThan(1);
  const backlinks = await links.backlinks("scale-0");
  expect(backlinks.status).toBe("ready");
  if (backlinks.status !== "ready") throw new Error("graph");
  expect(backlinks.items).toHaveLength(10000);
  expect(backlinks.items.every((row) => row.occurrences === 10)).toBe(true);
  const linked = await links.linkedNoteIds();
  expect(linked.status).toBe("ready");
  if (linked.status === "ready") expect(linked.items).toHaveLength(10000);
}, 30000);

it("exports only captured authorized selected notes and rejects stale held files", async () => {
  const { notes, links, a, b } = await setup();
  await links.verifyGraph();
  const target = (await links.reference(b.id)).target;
  const foreign = {
    ...target,
    accountId: "99999999-9999-4999-8999-999999999999",
  };
  await notes.update(
    a.id,
    {
      document: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "noteLink", attrs: { version: 1, target } },
              { type: "noteLink", attrs: { version: 1, target: foreign } },
            ],
          },
        ],
      },
    },
    1,
  );
  const ids = [a.id],
    prepared = links.prepareExport(ids);
  ids.push(b.id);
  const intent = await prepared;
  const result = await links.exportFiles(intent);
  await links.assertFreshExport(result);
  const json = JSON.parse(
    result.files.find((file) => file.filename === "notes.json")!.content,
  );
  expect(json.notes).toHaveLength(1);
  expect(json.notes[0].document).toEqual((await notes.get(a.id))!.document);
  const md = result.files
    .filter((file) => file.filename.endsWith(".md"))
    .map((file) => file.content)
    .join("\n");
  expect(md).toContain("Beta");
  expect(md).toContain("Note reference");
  expect(md).toContain("orbyn-notes://note/v1/");
  expect(Object.isFrozen(result.files)).toBe(true);
  await notes.update(b.id, { title: "Later target title" }, 1);
  await expect(links.assertFreshExport(result)).rejects.toMatchObject({
    code: "note_link_conflict",
  });
  await expect(links.exportFiles(intent)).rejects.toMatchObject({
    code: "note_link_conflict",
  });
  const newer = await links.prepareExport([a.id]);
  await notes.erase();
  await expect(links.exportFiles(newer)).rejects.toMatchObject({
    code: "note_link_revoked",
  });
});
it("exports remain available during structural-index recovery without trusting its rows", async () => {
  const { notes, links, a, b } = await setup();
  await links.verifyGraph();
  const target = (await links.reference(b.id)).target;
  await notes.update(a.id, { document: linked(target) }, 1);
  await mutateLibrary((state) => {
    state.noteLinks = { cachedTitle: "MUST NOT EXPORT" };
  });
  const result = await links.exportFiles(await links.prepareExport([a.id]));
  expect(result.files.map((file) => file.content).join("\n")).toContain("Beta");
  expect(result.files.map((file) => file.content).join("\n")).not.toContain(
    "MUST NOT EXPORT",
  );
});

it("uses the actual protected Notes proxy and closes without closing its borrowed owner", async () => {
  const { notes } = await setup();
  const protectedOwner = protectOperations(notes, [
      "create",
      "update",
      "erase",
    ]),
    service = createNoteLinkService(protectedOwner);
  handles.add(service);
  expect((await service.verifyGraph()).status).toBe("ready");
  const held = await service.prepareExport([(await notes.list())[0]!.id]);
  service.close();
  await expect(service.exportFiles(held)).rejects.toMatchObject({
    code: "note_link_revoked",
  });
  expect(await notes.list()).toHaveLength(2);
});

it("prunes a repair receipt only by the real shared500 cap and never reexecutes its expired intent", async () => {
  const { notes, links, a } = await setup();
  await links.verifyGraph();
  await notes.update(a.id, { title: "Admit" }, 1);
  await mutateLibrary((state) => {
    state.noteLinks = null;
  });
  await links.verifyGraph();
  const intent = await links.prepareRepair(await links.currentToken());
  await links.commitRepair(intent);
  await mutateLibrary((state) => {
    state.receipts.find(
      (row: any) => row.id === intent.operationId,
    ).committedAt = "2000-01-01T00:00:00.000Z";
    for (let i = 0; i < 499; i++)
      state.receipts.push({
        id: crypto.randomUUID(),
        epoch: state.epoch,
        committedAt: new Date(Date.now() + i).toISOString(),
        libraryRevision: state.revision,
        kind: "sort",
        arguments: "[]",
        result: { type: "metadata" },
      });
  });
  await notes.library.setSort(
    "title",
    await links.currentToken(),
    crypto.randomUUID(),
  );
  const state = await noteLinkOwner(notes).read();
  expect(state.library.receipts).toHaveLength(500);
  expect(
    state.library.receipts.some((row) => row.id === intent.operationId),
  ).toBe(false);
  const before = (await readRecord<DeviceRecord>("devices", identity.email))!;
  await expect(links.commitRepair(intent)).rejects.toMatchObject({
    code: "note_link_conflict",
  });
  expect(
    (await readRecord<DeviceRecord>("devices", identity.email))!.snapshot,
  ).toEqual(before.snapshot);
});

it("refuses new refs smuggled into legacy current OR history documents without read rewrite", async () => {
  const { notes, links, a, b } = await setup(),
    state = await noteLinkOwner(notes).read(),
    target = {
      kind: "note",
      accountId: identity.accountId,
      libraryEpoch: state.library.epoch,
      noteId: b.id,
    };
  const stage = (engine: SyncEngine, values: unknown[]) =>
    engine.stage(
      "notes-local",
      "notes_library",
      "library",
      JSON.stringify({
        notes: { value: values, stamp: JSON.parse(engine.tick(Date.now())) },
      }),
    );
  await mutateLibrary((library, engine) =>
    stage(engine, [{ ...a, document: linked(target) }, b]),
  );
  let before = (await readRecord<DeviceRecord>("devices", identity.email))!;
  await expect(openNotesStore(identity)).rejects.toThrow(
    "Unsupported document node",
  );
  expect(
    (await readRecord<DeviceRecord>("devices", identity.email))!.snapshot,
  ).toEqual(before.snapshot);
  await mutateLibrary((library, engine) => {
    stage(engine, [a, b]);
    library.versions = [
      {
        id: crypto.randomUUID(),
        noteId: a.id,
        noteRevision: 1,
        capturedAt: new Date().toISOString(),
        reason: "edit",
        title: a.title,
        document: linked(target),
        tagsAtCapture: [],
      },
    ];
  });
  before = (await readRecord<DeviceRecord>("devices", identity.email))!;
  await expect(openNotesStore(identity)).rejects.toThrow(
    "Unsupported document node",
  );
  expect(
    (await readRecord<DeviceRecord>("devices", identity.email))!.snapshot,
  ).toEqual(before.snapshot);
});

async function sameGenerationChange(effect: (engine: SyncEngine) => void) {
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
it("NL-D1 never reuses ready proof after authenticated same-generation current content changes", async () => {
  const { notes, links, a, b } = await setup();
  await links.verifyGraph();
  await notes.update(
    a.id,
    { document: linked((await links.reference(b.id)).target) },
    1,
  );
  await links.verifyGraph();
  const token = await links.currentToken(),
    generation = (await readRecord<DeviceRecord>("devices", identity.email))!
      .generation;
  await sameGenerationChange((engine) => {
    const raw = JSON.parse(engine.record("notes-local", "library")!);
    raw.fields.notes.value.find((note: any) => note.id === a.id).document =
      document;
    raw.fields.notes.stamp = JSON.parse(engine.tick(Date.now()));
    engine.stage(
      "notes-local",
      "notes_library",
      "library",
      JSON.stringify(raw.fields),
    );
  });
  expect(await links.currentToken()).toEqual(token);
  expect(
    (await readRecord<DeviceRecord>("devices", identity.email))!.generation,
  ).toBe(generation);
  expect(await links.verifyGraph()).toMatchObject({
    status: "invalid",
    code: "index-mismatch",
  });
});
it.each(["core", "history"])(
  "NL-D1 rejects same-generation %s content changes inside prepared repair",
  async (kind) => {
    const { notes, links, a, b } = await setup();
    await links.verifyGraph();
    await notes.update(
      a.id,
      { document: linked((await links.reference(b.id)).target) },
      1,
    );
    await mutateLibrary((state) => {
      state.noteLinks = [];
    });
    await links.verifyGraph();
    const intent = await links.prepareRepair(await links.currentToken());
    await sameGenerationChange((engine) => {
      if (kind === "core") {
        const raw = JSON.parse(engine.record("notes-local", "library")!);
        raw.fields.notes.value.find((note: any) => note.id === a.id).document =
          document;
        raw.fields.notes.stamp = JSON.parse(engine.tick(Date.now()));
        engine.stage(
          "notes-local",
          "notes_library",
          "library",
          JSON.stringify(raw.fields),
        );
      } else {
        const raw = JSON.parse(engine.record("notes-library-v1", "workspace")!);
        raw.fields.library.value.versions[0].document = {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "Changed historical passage" }],
            },
          ],
        };
        raw.fields.library.stamp = JSON.parse(engine.tick(Date.now()));
        engine.stage(
          "notes-library-v1",
          "notes_library_metadata",
          "workspace",
          JSON.stringify(raw.fields),
        );
      }
    });
    const before = (await readRecord<DeviceRecord>("devices", identity.email))!;
    await expect(links.commitRepair(intent)).rejects.toMatchObject({
      code: "note_link_conflict",
    });
    expect(
      (await readRecord<DeviceRecord>("devices", identity.email))!.snapshot,
    ).toEqual(before.snapshot);
    expect(
      (await readRecord<DeviceRecord>("devices", identity.email))!.generation,
    ).toBe(before.generation);
  },
);
it("NL-D1 fences legacy history changes while verification hashing is pending", async () => {
  const { notes, links, a } = await setup();
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>((resolve) => (entered = resolve)),
    barrier = new Promise<void>((resolve) => (release = resolve)),
    real = crypto.subtle.digest.bind(crypto.subtle);
  let first = true;
  vi.spyOn(crypto.subtle, "digest").mockImplementation(async (...args) => {
    if (first) {
      first = false;
      entered();
      await barrier;
    }
    return real(...args);
  });
  const job = links.verifyGraph();
  await started;
  await sameGenerationChange((engine) => {
    const raw = JSON.parse(engine.record("notes-library-v1", "workspace")!);
    raw.fields.library.value.versions = [
      {
        id: crypto.randomUUID(),
        noteId: a.id,
        noteRevision: 1,
        capturedAt: new Date().toISOString(),
        reason: "edit",
        title: a.title,
        document,
        tagsAtCapture: [],
      },
    ];
    raw.fields.library.stamp = JSON.parse(engine.tick(Date.now()));
    engine.stage(
      "notes-library-v1",
      "notes_library_metadata",
      "workspace",
      JSON.stringify(raw.fields),
    );
  });
  release();
  await expect(job).rejects.toMatchObject({ code: "note_link_conflict" });
});

it("coalesces forty concurrent real-owner resolutions into one owner restore/read", async () => {
  const { notes, links, a, b } = await setup(),
    owner = noteLinkOwner(notes),
    state = await owner.read(),
    spy = vi.spyOn(owner, "read");
  const results = await Promise.all(
    Array.from({ length: 40 }, (_, i) =>
      links.resolve({
        kind: "note",
        accountId: identity.accountId,
        libraryEpoch: state.library.epoch,
        noteId: i % 2 ? a.id : b.id,
      }),
    ),
  );
  expect(results.every((result) => result.status === "available")).toBe(true);
  expect(spy).toHaveBeenCalledTimes(1);
});
it("does not reuse settled authorization after same-generation external content changes", async () => {
  const { notes, links, b } = await setup(),
    owner = noteLinkOwner(notes),
    state = await owner.read(),
    target = {
      kind: "note" as const,
      accountId: identity.accountId,
      libraryEpoch: state.library.epoch,
      noteId: b.id,
    },
    spy = vi.spyOn(owner, "read");
  expect(await links.resolve(target)).toMatchObject({
    status: "available",
    title: "Beta",
  });
  await sameGenerationChange((engine) => {
    const raw = JSON.parse(engine.record("notes-local", "library")!);
    raw.fields.notes.value.find((note: any) => note.id === b.id).title =
      "External same-generation title";
    raw.fields.notes.stamp = JSON.parse(engine.tick(Date.now()));
    engine.stage(
      "notes-local",
      "notes_library",
      "library",
      JSON.stringify(raw.fields),
    );
  });
  expect(await links.resolve(target)).toMatchObject({
    status: "available",
    title: "External same-generation title",
  });
  expect(spy).toHaveBeenCalledTimes(2);
});
it("revokes every coalesced waiter on account lock without late labels", async () => {
  const { notes, links, b } = await setup(),
    owner = noteLinkOwner(notes),
    state = await owner.read(),
    real = owner.read.bind(owner);
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>((resolve) => (entered = resolve)),
    barrier = new Promise<void>((resolve) => (release = resolve));
  const spy = vi.spyOn(owner, "read").mockImplementation(async () => {
    const value = await real();
    entered();
    await barrier;
    return value;
  });
  const pending = Promise.allSettled(
    Array.from({ length: 20 }, () =>
      links.resolve({
        kind: "note",
        accountId: identity.accountId,
        libraryEpoch: state.library.epoch,
        noteId: b.id,
      }),
    ),
  );
  await started;
  lock();
  release();
  const results = await pending;
  expect(
    results.every(
      (row) =>
        row.status === "rejected" &&
        (row.reason as { code: string }).code === "note_link_revoked",
    ),
  ).toBe(true);
  expect(spy).toHaveBeenCalledTimes(1);
});

it("owner notifications bypass an older held read for later target resolutions", async () => {
  const { notes, links, b } = await setup(),
    owner = noteLinkOwner(notes),
    state = await owner.read(),
    target = {
      kind: "note" as const,
      accountId: identity.accountId,
      libraryEpoch: state.library.epoch,
      noteId: b.id,
    },
    real = owner.read.bind(owner);
  let entered!: () => void,
    release!: () => void,
    first = true;
  const started = new Promise<void>((resolve) => (entered = resolve)),
    barrier = new Promise<void>((resolve) => (release = resolve));
  vi.spyOn(owner, "read").mockImplementation(async () => {
    const value = await real();
    if (first) {
      first = false;
      entered();
      await barrier;
    }
    return value;
  });
  const older = links.resolve(target);
  await started;
  await notes.update(b.id, { title: "Changed while older read waits" }, 1);
  const newer = links.resolve(target);
  release();
  expect(await newer).toMatchObject({
    status: "available",
    title: "Changed while older read waits",
  });
  expect((await older).status).toBe("available");
});
it("erase notifications revoke older coalesced waiters and never return removed labels", async () => {
  const { notes, links, b } = await setup(),
    owner = noteLinkOwner(notes),
    state = await owner.read(),
    target = {
      kind: "note" as const,
      accountId: identity.accountId,
      libraryEpoch: state.library.epoch,
      noteId: b.id,
    },
    real = owner.read.bind(owner);
  let entered!: () => void,
    release!: () => void,
    first = true;
  const started = new Promise<void>((resolve) => (entered = resolve)),
    barrier = new Promise<void>((resolve) => (release = resolve));
  await links.resolve(target);
  vi.spyOn(owner, "read").mockImplementation(async () => {
    const value = await real();
    if (first) {
      first = false;
      entered();
      await barrier;
    }
    return value;
  });
  const pending = Promise.allSettled(
    Array.from({ length: 10 }, () => links.resolve(target)),
  );
  await started;
  await notes.erase();
  await links.currentToken().catch(() => {});
  release();
  const results = await pending;
  expect(
    results.every(
      (row) =>
        row.status === "rejected" &&
        (row.reason as { code: string }).code === "note_link_revoked",
    ),
  ).toBe(true);
});
it("clears failed in-flight reads so later authorization retries the real owner", async () => {
  const { notes, links, b } = await setup(),
    owner = noteLinkOwner(notes),
    state = await owner.read(),
    target = {
      kind: "note" as const,
      accountId: identity.accountId,
      libraryEpoch: state.library.epoch,
      noteId: b.id,
    };
  const spy = vi
    .spyOn(owner, "read")
    .mockRejectedValueOnce(new Error("synthetic owner read failure"));
  const failed = await Promise.allSettled(
    Array.from({ length: 10 }, () => links.resolve(target)),
  );
  expect(failed.every((row) => row.status === "rejected")).toBe(true);
  expect(spy).toHaveBeenCalledTimes(1);
  expect((await links.resolve(target)).status).toBe("available");
  expect(spy).toHaveBeenCalledTimes(2);
});

it("later-turn resolutions do not join an older held authenticated snapshot", async () => {
  const { notes, links, b } = await setup(),
    owner = noteLinkOwner(notes),
    state = await owner.read(),
    target = {
      kind: "note" as const,
      accountId: identity.accountId,
      libraryEpoch: state.library.epoch,
      noteId: b.id,
    },
    real = owner.read.bind(owner);
  let entered!: () => void,
    release!: () => void,
    first = true;
  const started = new Promise<void>((resolve) => (entered = resolve)),
    barrier = new Promise<void>((resolve) => (release = resolve));
  vi.spyOn(owner, "read").mockImplementation(async () => {
    const value = await real();
    if (first) {
      first = false;
      entered();
      await barrier;
    }
    return value;
  });
  const older = links.resolve(target);
  await started;
  await sameGenerationChange((engine) => {
    const raw = JSON.parse(engine.record("notes-local", "library")!);
    raw.fields.notes.value.find((note: any) => note.id === b.id).title =
      "External change while older read waits";
    raw.fields.notes.stamp = JSON.parse(engine.tick(Date.now()));
    engine.stage(
      "notes-local",
      "notes_library",
      "library",
      JSON.stringify(raw.fields),
    );
  });
  const later = links.resolve(target);
  release();
  expect(await later).toMatchObject({
    status: "available",
    title: "External change while older read waits",
  });
  await older;
});
