// @vitest-environment node
import { beforeAll, beforeEach, afterEach, it, expect, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import { Transform } from "@tiptap/pm/transform";
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
import { openCollectionsStore } from "../../src/collections/store";
import { protectOperations } from "../../src/desktop/closeGuard";
import { createStudySourceService } from "../../src/study/sourceStore";
import { studySourceOwner } from "../../src/library/store";
import {
  fingerprintSourceDocument,
  captureSourceSelection,
} from "../../src/study/sourceCodec";
import { createNoteSchema } from "../../src/editor/schema";
import { createDeck, gradeCard } from "../../src/study/model";
import type { NoteDocument } from "../../src/domain/contracts";
import type {
  MakeCardDraft,
  SourceExpected,
} from "../../src/study/sourceContracts";
const identity = {
  accountId: "11111111-1111-4111-8111-111111111111",
  deviceId: "22222222-2222-4222-8222-222222222222",
  email: "sources@example.test",
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
  const raw = await openNotesStore(identity);
  handles.add(raw);
  const notes = protectOperations(raw, ["create", "update", "erase"]);
  const note = await notes.create({ title: "Source note", document, tags: [] });
  const collections = await openCollectionsStore(identity);
  handles.add(collections);
  const current = await collections.read();
  const state = await collections.update(current, (current) => ({
    ...current,
    study: createDeck(current.study, "Actual source deck", new Date()),
  }));
  const service = createStudySourceService(notes, collections);
  handles.add(service);
  async function expected(): Promise<SourceExpected> {
    const library = await notes.library.read();
    if (library.mode !== "ready") throw new Error("fixture library");
    const state = await collections.read();
    return {
      library: library.snapshot.token,
      collections: { epoch: state.epoch, revision: state.revision },
    };
  }
  async function selection() {
    const current = (await notes.get(note.id))!,
      fingerprint = await fingerprintSourceDocument(current.document);
    return {
      noteId: note.id,
      noteRevision: current.revision,
      libraryEpoch: (await expected()).library.epoch,
      fingerprint,
      passage: captureSourceSelection(fingerprint.document, 8, 18).passage,
    };
  }
  async function make(type: "basic" | "reversed" | "cloze" = "basic") {
    const draft: MakeCardDraft =
      type === "cloze"
        ? {
            type,
            deckId: state.study.decks[0]!.id,
            tags: [],
            text: "Before {{answer}} After",
            blanks: [{ id: "answer", answer: "alpha beta" }],
          }
        : {
            type,
            deckId: state.study.decks[0]!.id,
            tags: [],
            front: "Which actual passage?",
            back: "alpha beta",
          };
    const intent = await service.prepareCreate(
      await selection(),
      await expected(),
      draft,
    );
    return { intent, saved: await service.commit(intent) };
  }
  async function edit(change: (tr: Transform) => void) {
    const current = (await notes.get(note.id))!,
      base = await fingerprintSourceDocument(current.document),
      schema = createNoteSchema(),
      tr = new Transform(schema.nodeFromJSON(base.document));
    change(tr);
    const final = await fingerprintSourceDocument(tr.doc.toJSON());
    return notes.library.updateWithSourceSteps(
      note.id,
      { document: final.document },
      current.revision,
      {
        baseDigest: base.digest,
        finalDigest: final.digest,
        steps: tr.steps.map((step) => step.toJSON()),
      },
    );
  }
  return { notes, collections, service, note, expected, selection, make, edit };
}
async function libraryEdit(change: (value: any) => void) {
  const stored = (await readRecord<DeviceRecord>("devices", identity.email))!,
    secret = await wrappingSecret(stored.wrapKey),
    keys = DeviceKeys.import(stored.sealedKeys, secret),
    engine = SyncEngine.restore(keys, stored.snapshot!, secret, Date.now());
  try {
    const state = JSON.parse(engine.record("notes-library-v1", "workspace")!)
      .fields.library.value;
    change(state);
    engine.stage(
      "notes-library-v1",
      "notes_library_metadata",
      "workspace",
      JSON.stringify({
        library: { value: state, stamp: JSON.parse(engine.tick(Date.now())) },
      }),
    );
    const snapshot = engine.snapshot(secret);
    await mutateRecord<DeviceRecord>("devices", identity.email, (current) => ({
      ...current!,
      snapshot,
      generation: current!.generation + 1,
    }));
  } finally {
    engine.free();
    keys.free();
    secret.fill(0);
  }
}
it.each(["basic", "reversed", "cloze"] as const)(
  "persists actual %s source cards through the real protected Notes Proxy",
  async (type) => {
    const f = await setup(),
      { saved } = await f.make(type);
    expect(saved.cardIds).toHaveLength(type === "reversed" ? 2 : 1);
    expect(saved.source).toMatchObject({
      status: "attached",
      noteId: f.note.id,
      noteRevision: 1,
      from: 8,
      to: 18,
      quote: "alpha beta",
    });
    const source = (await f.collections.read()).study.entries[0]!.source!;
    expect(source).toMatchObject({
      version: 2,
      noteRevision: 1,
      anchorId: saved.receipt.anchorId,
    });
    expect((await f.service.annotations(f.note.id))[0]).toEqual(saved.source);
    const fresh = createStudySourceService(f.notes, f.collections);
    handles.add(fresh);
    expect(await fresh.resolve(saved.entryId)).toEqual(saved.source);
  },
);
it("maps proven surrounding edits/formatting while birth remains immutable and duplicate quote is never searched", async () => {
  const f = await setup(),
    { saved } = await f.make();
  await f.edit((tr) => {
    tr.insert(1, tr.doc.type.schema.text("New "));
  });
  expect(JSON.stringify((await f.notes.get(f.note.id))!.document)).toContain(
    "New ",
  );
  const resolved = await f.service.resolve(saved.entryId);
  expect(resolved).toMatchObject({
    status: "attached",
    from: 12,
    to: 22,
    quote: "alpha beta",
    noteRevision: 2,
  });
  await f.edit((tr) => {
    tr.addMark(12, 22, tr.doc.type.schema.marks.bold!.create());
  });
  expect(await f.service.resolve(saved.entryId)).toMatchObject({
    status: "attached",
    from: 12,
    to: 22,
    noteRevision: 3,
  });
  const note = (await f.notes.get(f.note.id))!;
  await f.notes.update(note.id, { title: "Only title" }, note.revision);
  expect(await f.service.resolve(saved.entryId)).toMatchObject({
    status: "attached",
    from: 12,
    to: 22,
    noteRevision: 4,
  });
  expect(
    (await f.collections.read()).study.entries[0]!.source!.noteRevision,
  ).toBe(1);
  await libraryEdit((state) => {
    state.sourceReceipts = [];
  });
  expect(await f.service.resolve(saved.entryId)).toMatchObject({
    status: "attached",
    noteRevision: 4,
  });
});
it("stales and persists an actual identical-byte ReplaceStep without adding duplicate history", async () => {
  const f = await setup(),
    { saved } = await f.make(),
    beforeHistory = await f.notes.library.history(f.note.id);
  await f.edit((tr) => {
    tr.replaceWith(8, 18, tr.doc.type.schema.text("alpha beta"));
  });
  expect(await f.service.resolve(saved.entryId)).toEqual({
    status: "unavailable",
    reason: "stale",
  });
  expect(await f.notes.library.history(f.note.id)).toEqual(beforeHistory);
  const fresh = createStudySourceService(f.notes, f.collections);
  handles.add(fresh);
  expect(await fresh.resolve(saved.entryId)).toEqual({
    status: "unavailable",
    reason: "stale",
  });
});
it("carries source identity through atomic central tag rename and deletion", async () => {
  const f = await setup(),
    { saved } = await f.make();
  await f.notes.update(f.note.id, { tags: ["original"] }, 1);
  let library = await f.notes.library.read();
  if (library.mode !== "ready") throw new Error("fixture");
  const tagId = library.snapshot.tags[0]!.id;
  await f.notes.library.renameTag(
    tagId,
    "renamed",
    library.snapshot.token,
    crypto.randomUUID(),
  );
  expect(await f.service.resolve(saved.entryId)).toMatchObject({
    status: "attached",
    noteRevision: 3,
  });
  library = await f.notes.library.read();
  if (library.mode !== "ready") throw new Error("fixture");
  await f.notes.library.deleteTag(
    tagId,
    library.snapshot.token,
    crypto.randomUUID(),
  );
  expect(await f.service.resolve(saved.entryId)).toMatchObject({
    status: "attached",
    noteRevision: 4,
  });
});
it("detaches source anchors for confirmed same-document replacement recovery", async () => {
  const f = await setup(),
    { saved } = await f.make(),
    second = (await f.make()).saved;
  let current = (await f.notes.get(f.note.id))!;
  await f.notes.update(
    current.id,
    { title: current.title, document: current.document, tags: current.tags },
    current.revision,
  );
  expect(await f.service.resolve(saved.entryId)).toMatchObject({
    status: "attached",
  });
  current = (await f.notes.get(f.note.id))!;
  const history = await f.notes.library.history(current.id);
  await f.notes.library.replaceDocument(
    current.id,
    { title: current.title, document: current.document, tags: current.tags },
    current.revision,
  );
  expect(await f.service.resolve(saved.entryId)).toEqual({
    status: "unavailable",
    reason: "stale",
  });
  expect(await f.service.resolve(second.entryId)).toEqual({
    status: "unavailable",
    reason: "stale",
  });
  expect(await f.service.annotations(current.id)).toEqual([]);
  expect(await f.notes.library.history(current.id)).toEqual(history);
});
it.each(["quota", "stale-revision", "reauth", "erase"] as const)(
  "preserves the authoritative snapshot when explicit replacement fails at %s",
  async (failure) => {
    const f = await setup(),
      { saved } = await f.make(),
      current = (await f.notes.get(f.note.id))!;
    if (failure === "stale-revision")
      await f.notes.update(
        current.id,
        { title: "Newer saved title" },
        current.revision,
      );
    const input = {
      title: current.title,
      document: current.document,
      tags: current.tags,
    };
    let before = (await readRecord<DeviceRecord>("devices", identity.email))!;
    if (failure === "quota") {
      const put = vi
        .spyOn(IDBObjectStore.prototype, "put")
        .mockImplementationOnce(() => {
          throw new DOMException(
            "Synthetic replacement quota",
            "QuotaExceededError",
          );
        });
      try {
        await expect(
          f.notes.library.replaceDocument(current.id, input, current.revision),
        ).rejects.toThrow("replacement quota");
      } finally {
        put.mockRestore();
      }
    } else if (failure === "stale-revision") {
      await expect(
        f.notes.library.replaceDocument(current.id, input, current.revision),
      ).rejects.toMatchObject({ code: "revision_conflict" });
    } else {
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const sign = crypto.subtle.sign.bind(crypto.subtle);
      const signing = vi
        .spyOn(crypto.subtle, "sign")
        .mockImplementationOnce(async (...args) => {
          await gate;
          return sign(...args);
        });
      const pending = f.notes.library.replaceDocument(
        current.id,
        input,
        current.revision,
      );
      await vi.waitFor(() => expect(signing).toHaveBeenCalled());
      if (failure === "reauth") establish(identity);
      else await f.notes.erase();
      before = (await readRecord<DeviceRecord>("devices", identity.email))!;
      release();
      await expect(pending).rejects.toThrow();
    }
    const after = (await readRecord<DeviceRecord>("devices", identity.email))!;
    expect(after.snapshot).toEqual(before.snapshot);
    expect(after.generation).toBe(before.generation);
    if (failure === "quota" || failure === "stale-revision")
      expect(await f.service.resolve(saved.entryId)).toMatchObject({
        status: "attached",
      });
  },
);
it("captures the full explicit replacement draft before wrapping crypto awaits", async () => {
  const f = await setup(),
    { saved } = await f.make(),
    current = (await f.notes.get(f.note.id))!;
  const input = {
    title: "Captured title",
    document: structuredClone(current.document),
    tags: ["captured"],
  };
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const sign = crypto.subtle.sign.bind(crypto.subtle),
    signing = vi
      .spyOn(crypto.subtle, "sign")
      .mockImplementationOnce(async (...args) => {
        await gate;
        return sign(...args);
      });
  const pending = f.notes.library.replaceDocument(
    current.id,
    input,
    current.revision,
  );
  await vi.waitFor(() => expect(signing).toHaveBeenCalled());
  input.title = "Changed later";
  input.tags.push("not captured");
  input.document.content = [];
  release();
  const savedNote = await pending;
  expect(savedNote.title).toBe("Captured title");
  expect(savedNote.tags).toEqual(["captured"]);
  expect(savedNote.document).toEqual(current.document);
  expect(await f.service.resolve(saved.entryId)).toEqual({
    status: "unavailable",
    reason: "stale",
  });
});
it("stales attached anchors on an unproved history restore even when document bytes are identical", async () => {
  const f = await setup();
  await f.notes.update(f.note.id, { title: "A later title" }, f.note.revision);
  const version = (await f.notes.library.history(f.note.id))[0]!;
  const { saved } = await f.make();
  expect(await f.service.resolve(saved.entryId)).toMatchObject({
    status: "attached",
    noteRevision: 2,
  });
  const before = (await f.notes.get(f.note.id))!;
  expect(version.document).toEqual(before.document);
  await f.notes.library.restoreVersion(
    f.note.id,
    version.id,
    before.revision,
    crypto.randomUUID(),
  );
  expect((await f.notes.get(f.note.id))!.document).toEqual(before.document);
  expect(await f.service.resolve(saved.entryId)).toEqual({
    status: "unavailable",
    reason: "stale",
  });
});
it("never jumps to another identical quote after deletion or unverified replacement/history restore", async () => {
  const f = await setup(),
    { saved } = await f.make();
  await f.edit((tr) => {
    tr.delete(8, 18);
  });
  expect(await f.service.resolve(saved.entryId)).toEqual({
    status: "unavailable",
    reason: "stale",
  });
  const current = (await f.notes.get(f.note.id))!;
  await f.notes.update(current.id, { document }, current.revision);
  expect(await f.service.resolve(saved.entryId)).toEqual({
    status: "unavailable",
    reason: "stale",
  });
});
it("reconciles unknown committed create and Undo without duplicate cards or a second deletion", async () => {
  const f = await setup();
  const selection = await f.selection(),
    draft: MakeCardDraft = {
      type: "basic",
      deckId: (await f.collections.read()).study.decks[0]!.id,
      tags: [],
      front: "Actual question",
      back: "Actual answer",
    };
  const intent = await f.service.prepareCreate(
    selection,
    await f.expected(),
    draft,
  );
  const snapshotBefore = (await readRecord<DeviceRecord>(
    "devices",
    identity.email,
  ))!;
  const put = vi
    .spyOn(IDBObjectStore.prototype, "put")
    .mockImplementationOnce(() => {
      throw new DOMException("Synthetic source quota", "QuotaExceededError");
    });
  await expect(f.service.commit(intent)).rejects.toThrow("source quota");
  put.mockRestore();
  const afterFailure = (await readRecord<DeviceRecord>(
    "devices",
    identity.email,
  ))!;
  expect(afterFailure.snapshot).toEqual(snapshotBefore.snapshot);
  expect(afterFailure.generation).toBe(snapshotBefore.generation);
  const owner = studySourceOwner(f.notes),
    realCommit = owner.commit.bind(owner);
  vi.spyOn(owner, "commit").mockImplementationOnce(async (...args) => {
    await realCommit(...args);
    throw new Error("Synthetic unknown create result");
  });
  await expect(f.service.commit(intent)).rejects.toThrow(
    "unknown create result",
  );
  const saved = await f.service.commit(intent),
    replay = await f.service.commit(intent);
  expect(replay.replayed).toBe(true);
  expect(replay.receipt).toEqual(saved.receipt);
  const undo = await f.service.prepareUndo(
    saved.tokens,
    saved.receipt.operationId,
  );
  vi.spyOn(owner, "commit").mockImplementationOnce(async (...args) => {
    await realCommit(...args);
    throw new Error("Synthetic unknown Undo result");
  });
  await expect(f.service.commit(undo)).rejects.toThrow("unknown Undo result");
  const undone = await f.service.commit(undo);
  expect(undone.source).toEqual({ status: "unavailable", reason: "missing" });
  expect((await f.collections.read()).study.entries).toHaveLength(0);
  const beforeReplay = (await readRecord<DeviceRecord>(
    "devices",
    identity.email,
  ))!;
  const retry = await f.service.commit(undo);
  expect(retry.replayed).toBe(true);
  expect(retry.receipt).toEqual(undone.receipt);
  const afterReplay = (await readRecord<DeviceRecord>(
    "devices",
    identity.email,
  ))!;
  expect(afterReplay.snapshot).toEqual(beforeReplay.snapshot);
  expect(afterReplay.generation).toBe(beforeReplay.generation);
});
it.each(["review", "source-edit", "expiry"] as const)(
  "refuses create Undo after %s",
  async (reason) => {
    const f = await setup(),
      { saved } = await f.make();
    if (reason === "review") {
      const current = await f.collections.read();
      await f.collections.update(current, (current) => ({
        ...current,
        study: gradeCard(
          current.study,
          saved.cardIds[0]!,
          "good",
          crypto.randomUUID(),
          crypto.randomUUID(),
          new Date(),
        ),
      }));
    } else if (reason === "source-edit")
      await f.edit((tr) => {
        tr.insert(1, tr.doc.type.schema.text("Outside "));
      });
    else {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(Date.now() + 5001);
    }
    const undo = await f.service.prepareUndo(
      await f.expected(),
      saved.receipt.operationId,
    );
    await expect(f.service.commit(undo)).rejects.toThrow(
      "source_undo_unavailable",
    );
    expect((await f.collections.read()).study.entries).toHaveLength(1);
  },
);
it("rejects forged source birth through the ordinary Collections writer", async () => {
  const f = await setup();
  await f.make();
  const current = await f.collections.read();
  await expect(
    f.collections.update(current, (current) => {
      current.study.entries[0]!.source!.noteRevision++;
      return current;
    }),
  ).rejects.toThrow("Anchored source birth");
});
it.each(["lock", "erase", "close"] as const)(
  "revokes prepared work on %s",
  async (reason) => {
    const f = await setup(),
      selection = await f.selection(),
      expected = await f.expected();
    const intent = await f.service.prepareCreate(selection, expected, {
      type: "basic",
      deckId: (await f.collections.read()).study.decks[0]!.id,
      tags: [],
      front: "Question",
      back: "Answer",
    });
    if (reason === "lock") establish(identity);
    else if (reason === "close") f.service.close();
    else await f.notes.erase();
    await expect(f.service.commit(intent)).rejects.toThrow();
    const current = await openCollectionsStore(identity);
    handles.add(current);
    expect((await current.read()).study.entries).toHaveLength(0);
  },
);
it("revokes hashing across erase and rejects source-aware note proof hashing across same-handle erase", async () => {
  const f = await setup(),
    selection = await f.selection(),
    expected = await f.expected(),
    draft: MakeCardDraft = {
      type: "basic",
      deckId: (await f.collections.read()).study.decks[0]!.id,
      tags: [],
      front: "Question",
      back: "Answer",
    };
  let release!: () => void;
  let gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const digest = crypto.subtle.digest.bind(crypto.subtle);
  const hashing = vi
    .spyOn(crypto.subtle, "digest")
    .mockImplementationOnce(async (...args) => {
      await gate;
      return digest(...args);
    });
  const pending = f.service.prepareCreate(selection, expected, draft);
  await vi.waitFor(() => expect(hashing).toHaveBeenCalled());
  await f.notes.erase();
  release();
  await expect(pending).rejects.toThrow("source_revoked");
  hashing.mockRestore();
  const fresh = await f.notes.create({
      title: "New epoch",
      document,
      tags: [],
    }),
    base = await fingerprintSourceDocument(fresh.document);
  gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const proofHash = vi
    .spyOn(crypto.subtle, "digest")
    .mockImplementationOnce(async (...args) => {
      await gate;
      return digest(...args);
    });
  const updating = f.notes.library.updateWithSourceSteps(
    fresh.id,
    { title: "Old intent" },
    fresh.revision,
    { baseDigest: base.digest, finalDigest: base.digest, steps: [] },
  );
  await vi.waitFor(() => expect(proofHash).toHaveBeenCalled());
  await f.notes.erase();
  release();
  await expect(updating).rejects.toThrow("epoch");
  expect(await f.notes.list()).toEqual([]);
});
it("revokes a pending atomic writer when the source facade closes while wrapping crypto is delayed", async () => {
  const f = await setup(),
    intent = await f.service.prepareCreate(
      await f.selection(),
      await f.expected(),
      {
        type: "basic",
        deckId: (await f.collections.read()).study.decks[0]!.id,
        tags: [],
        front: "Question",
        back: "Answer",
      },
    );
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const sign = crypto.subtle.sign.bind(crypto.subtle),
    signing = vi
      .spyOn(crypto.subtle, "sign")
      .mockImplementationOnce(async (...args) => {
        await gate;
        return sign(...args);
      });
  const pending = f.service.commit(intent);
  await vi.waitFor(() => expect(signing).toHaveBeenCalled());
  f.service.close();
  release();
  await expect(pending).rejects.toThrow("source_revoked");
  expect((await f.collections.read()).study.entries).toEqual([]);
});
it("bounds many short annotations in a large nested document before batch mapping, while title-only changes remain usable", async () => {
  const f = await setup(),
    large: NoteDocument = {
      type: "doc",
      content: Array.from({ length: 2000 }, () => ({
        type: "blockquote",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "a".repeat(400) }],
          },
        ],
      })),
    };
  await f.notes.update(f.note.id, { document: large }, f.note.revision);
  await f.make();
  await libraryEdit((state) => {
    const anchor = state.anchors[0];
    // Valid orphan sidecars can remain after independently deleting Study entries.
    for (let i = 0; i < 50; i++)
      state.anchors.push({
        ...structuredClone(anchor),
        id: crypto.randomUUID(),
        entryId: crypto.randomUUID(),
      });
  });
  const current = (await f.notes.get(f.note.id))!,
    fingerprint = await fingerprintSourceDocument(current.document),
    schema = createNoteSchema(),
    tr = new Transform(schema.nodeFromJSON(fingerprint.document));
  tr.addMark(8, 18, schema.marks.bold!.create());
  const final = await fingerprintSourceDocument(tr.doc.toJSON()),
    before = (await readRecord<DeviceRecord>("devices", identity.email))!;
  await expect(
    f.notes.library.updateWithSourceSteps(
      current.id,
      { document: final.document },
      current.revision,
      {
        baseDigest: fingerprint.digest,
        finalDigest: final.digest,
        steps: tr.steps.map((step) => step.toJSON()),
      },
    ),
  ).rejects.toThrow("work limit");
  const after = (await readRecord<DeviceRecord>("devices", identity.email))!;
  expect(after.snapshot).toEqual(before.snapshot);
  expect(after.generation).toBe(before.generation);
  expect(
    (
      await f.notes.update(
        current.id,
        { title: "Metadata remains editable" },
        current.revision,
      )
    ).title,
  ).toBe("Metadata remains editable");
}, 15000);
