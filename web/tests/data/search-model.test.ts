// @vitest-environment node
import { beforeAll, afterEach, it, expect, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { IDBFactory } from "fake-indexeddb";
import {
  initSync,
  DeviceKeys,
  SyncEngine,
} from "../../src/generated/wasm/orbyn_wasm.js";
import {
  newWrappingKey,
  wrappingSecret,
  mutateRecord,
  type DeviceRecord,
} from "../../src/data/database";
import { establish, lock } from "../../src/account/session";
import { openNotesStore } from "../../src/data";
import {
  openCollectionsStore,
  replaceJournal,
} from "../../src/collections/store";
import {
  emptyJournal,
  createJournalEnvelope,
} from "../../src/collections/journal";
import { createDeck, saveEntry } from "../../src/study/model";
import {
  acquireSearchSource,
  searchSourceReader,
  releaseSearchSource,
  assertSearchSourceFresh,
} from "../../src/search/source";
import { compileSearchQuery } from "../../src/search/text";
import {
  buildSearchIndex,
  searchIndexCounts,
  projectSearchPage,
  disposeSearchIndex,
  type SearchIndex,
} from "../../src/search/model";
import { createNoteLinkService } from "../../src/links/store";
import { SearchWork, type WorkEvent } from "../../src/search/work";
import type { NoteDocument } from "../../src/domain/contracts";
import type { SearchLease } from "../../src/search/contracts";
const identity = {
  accountId: "11111111-1111-4111-8111-111111111111",
  deviceId: "22222222-2222-4222-8222-222222222222",
  email: "model@example.test",
  deviceState: "trusted" as const,
};
const handles = new Set<{ close(): void }>(),
  leases = new Set<SearchLease>(),
  indexes = new Set<SearchIndex>();
beforeAll(async () =>
  initSync({
    module: await readFile(
      new URL("../../src/generated/wasm/orbyn_wasm_bg.wasm", import.meta.url),
    ),
  }),
);
afterEach(() => {
  for (const index of indexes) disposeSearchIndex(index);
  indexes.clear();
  for (const lease of leases) releaseSearchSource(lease);
  leases.clear();
  for (const h of handles) h.close();
  handles.clear();
  lock();
  vi.restoreAllMocks();
});
const doc = (text: string): NoteDocument => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});
async function fixture() {
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
    title: "Common Zulu",
    document: doc("body needle"),
    tags: ["alpha"],
  });
  const target = await notes.create({
    title: "Current Authorized Label",
    document: doc("other"),
    tags: [],
  });
  const trash = await notes.create({
    title: "Common trash-secret",
    document: doc("hidden-trash"),
    tags: [],
  });
  await notes.trash(trash.id, 1);
  const current = await collections.read(),
    at = new Date("2026-01-01T00:00:00.000Z");
  await collections.update(current, (state) => {
    let study = createDeck(state.study, "Deck Metadata", at);
    const deckId = study.decks[0]!.id;
    for (const type of ["basic", "reversed", "cloze"] as const) {
      const base = {
        id: crypto.randomUUID(),
        deckId,
        revision: 1,
        tags: ["tag-value"],
        source: {
          noteId: note.id,
          noteRevision: 1,
          quote: "hidden-source-quote",
        },
      };
      study = saveEntry(
        study,
        type === "cloze"
          ? {
              ...base,
              type,
              text: "Common {{one}} then {{two}}",
              blanks: [
                { id: "one", answer: "First Answer" },
                { id: "two", answer: "Second Answer" },
              ],
            }
          : {
              ...base,
              type,
              front: "Common Question " + type,
              back: "Common Answer " + type,
            },
        at,
      );
    }
    return {
      ...state,
      study,
      clips: {
        ...state.clips,
        items: [
          {
            id: crypto.randomUUID(),
            revision: 1,
            title: "Common archive",
            originalUrl: "https://example.test/path",
            canonicalUrl: "https://example.test/path",
            text: "saved needle",
            createdAt: at.toISOString(),
            updatedAt: at.toISOString(),
            readAt: null,
            readLater: false,
            archivedAt: at.toISOString(),
          },
        ],
      },
    };
  });
  return { notes, collections, note, target };
}
async function source(f: Awaited<ReturnType<typeof fixture>>) {
  const lease = await acquireSearchSource(f.notes, f.collections);
  leases.add(lease);
  return { lease, reader: searchSourceReader(lease) };
}
async function done<T>(iterator: Generator<WorkEvent, T, void>) {
  const runner = new SearchWork(iterator);
  for (let i = 0; i < 100; i++) {
    const result = await runner.round();
    if (result.status === "done") return result.value;
  }
  throw new Error("Did not finish bounded search.");
}
async function build(f: Awaited<ReturnType<typeof fixture>>, raw: string) {
  const { lease, reader } = await source(f),
    index = await done(buildSearchIndex(reader, compileSearchQuery(raw)!));
  indexes.add(index);
  return { index, lease };
}
it("matches real Notes/archived Clips/actual Reversed2+ClozeN cards with exact counts and lazy pages", async () => {
  const f = await fixture();
  await source(f);
  const restore = vi.spyOn(SyncEngine, "restore"),
    { index, lease } = await build(f, "common");
  expect(searchIndexCounts(index)).toEqual({
    notes: 1,
    clips: 1,
    cards: 5,
    all: 7,
  });
  const notes = await done(projectSearchPage(index, "note", 0, 50)),
    clips = await done(projectSearchPage(index, "clip", 0, 50)),
    cards = await done(projectSearchPage(index, "card", 0, 50));
  expect(notes[0]!.primary.text).toBe("Common Zulu");
  expect(notes[0]!.primary.matches).toEqual([{ from: 0, to: 6 }]);
  expect(clips[0]).toMatchObject({ archived: true, clipContent: "saved-text" });
  expect(
    cards.map((card) => (card.locator.kind === "card" ? card.locator.key : "")),
  ).toEqual([
    "basic:forward",
    "reversed:forward",
    "reversed:reverse",
    "cloze:one",
    "cloze:two",
  ]);
  expect(cards.at(-2)!.primary.text).toContain("[...]");
  await assertSearchSourceFresh(lease);
  expect(restore).not.toHaveBeenCalled();
});
it("ANDs distinct terms across actual eligible fields, uses primary rank, and excludes source/trash/Journal", async () => {
  const f = await fixture();
  expect(
    searchIndexCounts((await build(f, "common alpha needle")).index),
  ).toEqual({ notes: 1, clips: 0, cards: 0, all: 1 });
  expect(
    searchIndexCounts((await build(f, "common example.test saved")).index),
  ).toEqual({ notes: 0, clips: 1, cards: 0, all: 1 });
  expect(
    searchIndexCounts((await build(f, "common metadata tag-value")).index)
      .cards,
  ).toBe(5);
  const current = await f.collections.read(),
    journal = emptyJournal();
  journal.habits.push({
    id: crypto.randomUUID(),
    name: "hidden-journal",
    order: 0,
    createdAt: new Date().toISOString(),
    createdOn: "2026-01-01",
    archivedAt: null,
    archivedOn: null,
    revision: 1,
  });
  const sealed = await createJournalEnvelope(
    "synthetic passphrase",
    journal,
    {
      accountId: identity.accountId,
      epoch: current.epoch,
    },
    () => {},
  );
  await replaceJournal(f.collections, current, sealed.envelope);
  for (const query of [
    "hidden-source-quote",
    "hidden-trash",
    "trash-secret",
    "hidden-journal",
  ])
    expect(searchIndexCounts((await build(f, query)).index).all).toBe(0);
});
it("uses only current authorized typed-reference labels and preserves marked-node continuity/block boundaries", async () => {
  const f = await fixture(),
    links = createNoteLinkService(f.notes);
  handles.add(links);
  await links.verifyGraph();
  const library = await f.notes.library.read();
  if (library.mode !== "ready") throw new Error("fixture");
  const target = {
    kind: "note" as const,
    accountId: identity.accountId,
    libraryEpoch: library.snapshot.token.epoch,
    noteId: f.target.id,
  };
  await f.notes.update(
    f.note.id,
    {
      document: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "stra" },
              { type: "text", text: "ße", marks: [{ type: "bold" }] },
              { type: "text", text: " before " },
              { type: "noteLink", attrs: { version: 1, target } },
              { type: "text", text: " after" },
            ],
          },
          { type: "paragraph", content: [{ type: "text", text: "separate" }] },
        ],
      },
    },
    1,
  );
  expect(searchIndexCounts((await build(f, "strasse")).index).notes).toBe(1);
  expect(searchIndexCounts((await build(f, "afterseparate")).index).notes).toBe(
    0,
  );
  expect(
    searchIndexCounts((await build(f, "authorized label")).index).notes,
  ).toBe(2);
  await f.notes.update(f.target.id, { title: "Renamed Current" }, 1);
  expect(searchIndexCounts((await build(f, "authorized")).index).notes).toBe(0);
  expect(searchIndexCounts((await build(f, "renamed")).index).notes).toBe(2);
  const n = (await f.notes.get(f.note.id))!;
  await f.notes.update(
    n.id,
    {
      document: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "before" },
              {
                type: "noteLink",
                attrs: {
                  version: 1,
                  target: {
                    ...target,
                    accountId: "33333333-3333-4333-8333-333333333333",
                  },
                },
              },
              { type: "text", text: "after" },
            ],
          },
        ],
      },
    },
    n.revision,
  );
  expect(searchIndexCounts((await build(f, "beforeafter")).index).notes).toBe(
    0,
  );
  expect(searchIndexCounts((await build(f, "renamed")).index).notes).toBe(1);
});
it("streams Cloze marker boundaries and hidden answers without searching synthetic placeholders", async () => {
  const f = await fixture(),
    current = await f.collections.read(),
    entry = current.study.entries.find((entry) => entry.type === "cloze")!;
  await f.collections.update(current, (state) => ({
    ...state,
    study: saveEntry(
      state.study,
      {
        ...entry,
        type: "cloze",
        revision: entry.revision + 1,
        text: "x".repeat(4094) + "{{{one}}} and {{two}}",
        blanks: [
          { id: "one", answer: "cross-answer" },
          { id: "two", answer: "second-answer" },
        ],
      },
      new Date(),
    ),
  }));
  const { index } = await build(f, "cross-answer second-answer");
  expect(searchIndexCounts(index).cards).toBe(2);
  const cards = await done(projectSearchPage(index, "card", 0, 50));
  expect(cards.every((card) => card.primary.text.length <= 240)).toBe(true);
  expect(searchIndexCounts((await build(f, "[...]")).index).cards).toBe(0);
});
it("resumes work without top-N counts and pages exact ordered matches beyond50", async () => {
  const f = await fixture();
  for (let i = 0; i < 65; i++)
    await f.notes.create({
      title: "Common " + String(i).padStart(3, "0"),
      document: doc("body"),
      tags: [],
    });
  const { reader } = await source(f);
  const work = new SearchWork(
    buildSearchIndex(reader, compileSearchQuery("common")!),
    { bytes: 3000000, visits: 1000 },
    async () => {},
  );
  let rounds = 0,
    index: SearchIndex | undefined;
  for (; rounds < 100; rounds++) {
    const result = await work.round();
    if (result.status === "done") {
      index = result.value;
      break;
    }
  }
  expect(index).toBeDefined();
  indexes.add(index!);
  expect(rounds).toBeGreaterThan(0);
  expect(searchIndexCounts(index!).notes).toBe(66);
  const first = await done(projectSearchPage(index!, "note", 0, 50)),
    second = await done(projectSearchPage(index!, "note", 50, 50));
  expect(first).toHaveLength(50);
  expect(second).toHaveLength(16);
  expect(
    new Set(
      [...first, ...second].map((hit) =>
        hit.locator.kind === "note" ? hit.locator.noteId : "",
      ),
    ),
  ).toHaveLength(66);
});
it("bounds huge fields within continuation, cancels pending work, and rejects forged/disposed indexes", async () => {
  const f = await fixture();
  await f.notes.update(
    f.note.id,
    { document: doc("a".repeat(300000) + "needle") },
    1,
  );
  const { reader } = await source(f),
    iterator = buildSearchIndex(reader, compileSearchQuery("needle")!),
    work = new SearchWork(
      iterator,
      { bytes: 2000000, visits: 1000 },
      async () => {},
    );
  expect((await work.round()).status).toBe("paused");
  work.close();
  await expect(work.round()).rejects.toMatchObject({ name: "AbortError" });
  const { index } = await build(f, "needle");
  expect(searchIndexCounts(index).notes).toBe(1);
  const pageWork = new SearchWork(
    projectSearchPage(index, "note", 0, 50),
    { bytes: 2000000, visits: 1000 },
    async () => {},
  );
  expect((await pageWork.round()).status).toBe("paused");
  expect(searchIndexCounts(index).notes).toBe(1);
  let page: readonly import("../../src/search/results").SearchHit[] = [];
  for (let rounds = 0; rounds < 100; rounds++) {
    const result = await pageWork.round();
    if (result.status === "done") {
      page = result.value;
      break;
    }
  }
  expect(page).toHaveLength(1);
  expect(page[0]!.secondary[0]!.text.length).toBeLessThanOrEqual(240);
  disposeSearchIndex(index);
  expect(() => searchIndexCounts(index)).toThrow();
  expect(() => searchIndexCounts({} as SearchIndex)).toThrow();
  expect(() => projectSearchPage(index, "note", 0, 50).next()).toThrow();
});

it("orders primary hits first, then real timestamps/title and stable card provenance", async () => {
  const f = await fixture();
  vi.useFakeTimers({ toFake: ["Date"] });
  try {
    vi.setSystemTime(new Date("2030-01-01T00:00:00Z"));
    const z = await f.notes.create({
      title: "needle zeta",
      document: doc("none"),
      tags: [],
    });
    const a = await f.notes.create({
      title: "needle Alpha",
      document: doc("none"),
      tags: [],
    });
    vi.setSystemTime(new Date("2030-01-02T00:00:00Z"));
    const newer = await f.notes.create({
      title: "needle newest",
      document: doc("none"),
      tags: [],
    });
    vi.setSystemTime(new Date("2030-01-03T00:00:00Z"));
    const body = await f.notes.create({
      title: "Body only",
      document: doc("needle"),
      tags: [],
    });
    const { index } = await build(f, "needle");
    const page = await done(projectSearchPage(index, "note", 0, 50));
    const ids = page.map((hit) =>
      hit.locator.kind === "note" ? hit.locator.noteId : "",
    );
    expect(ids.slice(0, 3)).toEqual([newer.id, a.id, z.id]);
    expect(ids.slice(3)).toContain(body.id);
  } finally {
    vi.useRealTimers();
  }
});
it("keeps full500-unit actual title and marks late Unicode hits without splitting scalars", async () => {
  const f = await fixture(),
    title = "x".repeat(450) + " Straße " + "y".repeat(42);
  await f.notes.update(f.note.id, { title }, 1);
  const { index } = await build(f, "strasse");
  const page = await done(projectSearchPage(index, "note", 0, 50));
  expect(page[0]!.primary.text).toBe(title);
  expect(
    page[0]!.primary.matches.map((range) => title.slice(range.from, range.to)),
  ).toEqual(["Straße"]);
});
it("does not mark a display-only selected Cloze placeholder when identical literal text is searchable", async () => {
  const f = await fixture(),
    current = await f.collections.read(),
    entry = current.study.entries.find((entry) => entry.type === "cloze")!;
  await f.collections.update(current, (state) => ({
    ...state,
    study: saveEntry(
      state.study,
      {
        ...entry,
        type: "cloze",
        revision: entry.revision + 1,
        text: "{{one}} literal [...] {{two}}",
        blanks: [
          { id: "one", answer: "first" },
          { id: "two", answer: "second" },
        ],
      },
      new Date(),
    ),
  }));
  const { index } = await build(f, "[...]");
  const cards = await done(projectSearchPage(index, "card", 0, 50));
  const first = cards.find(
    (hit) => hit.locator.kind === "card" && hit.locator.key === "cloze:one",
  )!;
  expect(first.primary.text).toBe("[...] literal [...] second");
  expect(first.primary.matches).toEqual([{ from: 14, to: 19 }]);
});
it("disposal terminates a held page iterator and rejects future readers", async () => {
  const f = await fixture(),
    { index } = await build(f, "common"),
    page = projectSearchPage(index, "card", 0, 50);
  expect(page.next().done).toBe(false);
  disposeSearchIndex(index);
  expect(page.next().done).toBe(true);
  expect(() => projectSearchPage(index, "card", 0, 50)).toThrow();
});

it("keeps an authorized empty-title reference as a nonsearchable boundary", async () => {
  const f = await fixture(),
    links = createNoteLinkService(f.notes);
  handles.add(links);
  await links.verifyGraph();
  await f.notes.update(f.target.id, { title: "" }, 1);
  const library = await f.notes.library.read();
  if (library.mode !== "ready") throw new Error("fixture");
  const target = {
    kind: "note" as const,
    accountId: identity.accountId,
    libraryEpoch: library.snapshot.token.epoch,
    noteId: f.target.id,
  };
  await f.notes.update(
    f.note.id,
    {
      document: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "a" },
              { type: "noteLink", attrs: { version: 1, target } },
              { type: "text", text: "b" },
            ],
          },
          {
            type: "paragraph",
            content: [{ type: "text", text: "actual source passage" }],
          },
        ],
      },
    },
    1,
  );
  expect(searchIndexCounts((await build(f, "ab")).index).notes).toBe(0);
  const positive = await build(f, "a b actual source passage");
  expect(searchIndexCounts(positive.index).notes).toBe(1);
  const page = await done(projectSearchPage(positive.index, "note", 0, 50));
  expect(page[0]!.secondary.length).toBeGreaterThan(0);
});

it("projects the exact1000-unit legal deck title and late genuine highlight", async () => {
  const f = await fixture(),
    current = await f.collections.read(),
    title = "x".repeat(950) + "DeckNeedle" + "y".repeat(40);
  await f.collections.update(current, (state) => ({
    ...state,
    study: {
      ...state.study,
      decks: state.study.decks.map((deck) => ({
        ...deck,
        title,
        revision: deck.revision + 1,
      })),
    },
  }));
  const { index } = await build(f, "deckneedle");
  expect(searchIndexCounts(index).cards).toBe(5);
  const cards = await done(projectSearchPage(index, "card", 0, 50));
  for (const card of cards) {
    expect(card.deckTitle).toBe(title);
    const deck = card.secondary.find((part) => part.text === title)!;
    expect(deck).toBeDefined();
    expect(deck.matches).toEqual([{ from: 950, to: 960 }]);
  }
});
