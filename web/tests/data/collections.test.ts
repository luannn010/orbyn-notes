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
import {
  openCollectionsStore,
  replaceJournal,
  onCollectionsEpochChange,
  COLLECTIONS_ZONE,
} from "../../src/collections/store";
import { CollectionsRevisionConflictError } from "../../src/collections/contracts";
import type {
  CollectionsState,
  CollectionsStore,
  JournalEnvelope,
} from "../../src/collections/contracts";
import {
  validateCollections,
  validateJournalEnvelope,
} from "../../src/collections/validation";
import { openNotesStore } from "../../src/data";
import {
  newWrappingKey,
  wrappingSecret,
  mutateRecord,
  readRecord,
} from "../../src/data/database";
import type { DeviceRecord } from "../../src/data/database";
import * as database from "../../src/data/database";
import { establish, lock } from "../../src/account/session";

const identity = {
  accountId: "11111111-1111-4111-8111-111111111111",
  deviceId: "22222222-2222-4222-8222-222222222222",
  email: "collections@example.test",
  deviceState: "trusted" as const,
};
const deckId = "33333333-3333-4333-8333-333333333333";
const entryId = "44444444-4444-4444-8444-444444444444";
const cardId = "55555555-5555-4555-8555-555555555555";
const at = "2026-11-11T00:00:00.000Z";
const handles = new Set<{ close(): void }>();
async function open() {
  const store = await openCollectionsStore(identity);
  handles.add(store);
  return store;
}
function deck(
  state: CollectionsState,
  title = "Private synthetic deck",
): CollectionsState {
  return {
    ...state,
    study: {
      ...state.study,
      decks: [{ id: deckId, title, createdAt: at, updatedAt: at, revision: 1 }],
    },
  };
}
function card(state: CollectionsState): CollectionsState {
  const next = deck(state);
  next.study.entries = [
    {
      id: entryId,
      deckId,
      revision: 1,
      tags: [],
      source: null,
      type: "basic",
      front: "Secret question",
      back: "Secret answer",
    },
  ];
  next.study.cards = [
    {
      id: cardId,
      entryId,
      key: "basic:forward",
      revision: 1,
      schedule: {
        version: 1,
        state: "new",
        due: at,
        intervalDays: 0,
        ease: 2.5,
        repetitions: 0,
        lapses: 0,
        lastReviewedAt: null,
      },
    },
  ];
  return next;
}
async function writePayload(value: unknown) {
  const record = (await readRecord<DeviceRecord>("devices", identity.email))!;
  const secret = await wrappingSecret(record.wrapKey);
  try {
    await mutateRecord<DeviceRecord>("devices", identity.email, (current) => {
      const keys = DeviceKeys.import(current!.sealedKeys, secret);
      const engine = SyncEngine.restore(
        keys,
        current!.snapshot!,
        secret,
        Date.now(),
      );
      try {
        engine.stage(
          COLLECTIONS_ZONE,
          "notes_collections",
          "workspace",
          JSON.stringify({
            collections: { value, stamp: JSON.parse(engine.tick(Date.now())) },
          }),
        );
        return {
          ...current!,
          snapshot: engine.snapshot(secret),
          generation: current!.generation + 1,
        };
      } finally {
        engine.free();
        keys.free();
      }
    });
  } finally {
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
  const wrapKey = await newWrappingKey();
  const secret = await wrappingSecret(wrapKey);
  const keys = DeviceKeys.create();
  try {
    await mutateRecord<DeviceRecord>("devices", identity.email, () => ({
      ...identity,
      wrapKey,
      sealedKeys: keys.export(secret),
      generation: 0,
      verifiedTrust: true,
    }));
  } finally {
    secret.fill(0);
    keys.free();
  }
  establish(identity);
});
afterEach(() => {
  for (const store of handles) store.close();
  handles.clear();
  vi.restoreAllMocks();
  lock();
});

describe("real WASM encrypted collections", () => {
  it("captures a non-UTC local timezone once and retains it after host timezone changes", async () => {
    const Original = Intl.DateTimeFormat;
    let hostZone = "Australia/Sydney";
    vi.spyOn(Intl, "DateTimeFormat").mockImplementation(
      function (locales, options) {
        const formatter = new Original(locales, options);
        if (locales === undefined && options === undefined) {
          const resolved = formatter.resolvedOptions();
          formatter.resolvedOptions = () => ({
            ...resolved,
            timeZone: hostZone,
          });
        }
        return formatter;
      },
    );
    const store = await open();
    expect((await store.read()).study.preferences.timezone).toBe(
      "Australia/Sydney",
    );
    store.close();
    hostZone = "UTC";
    expect((await (await open()).read()).study.preferences.timezone).toBe(
      "Australia/Sydney",
    );
  });
  it("persists one initial epoch across simultaneous open and reopen", async () => {
    const [a, b] = await Promise.all([open(), open()]);
    const initial = await a.read();
    expect(await b.read()).toEqual(initial);
    expect(initial.revision).toBe(0);
    a.close();
    expect(await (await open()).read()).toEqual(initial);
  });
  it("coexists with Notes writes and stores only encrypted feature bytes", async () => {
    const notes = await openNotesStore(identity);
    handles.add(notes);
    const note = await notes.create({
      title: "Secret note",
      document: { type: "doc", content: [] },
      tags: [],
    });
    const store = await open();
    const initial = await store.read();
    const saved = await store.update(initial, card);
    await notes.update(note.id, { title: "Updated note" }, note.revision);
    expect(await store.read()).toEqual(saved);
    const raw = (await readRecord<DeviceRecord>("devices", identity.email))!;
    const bytes = new TextDecoder().decode(raw.snapshot);
    for (const secret of [
      "Private synthetic deck",
      "Secret question",
      "Secret answer",
      "Updated note",
    ])
      expect(bytes).not.toContain(secret);
    expect(Object.keys(raw)).not.toContain("study");
    expect((await notes.get(note.id))?.title).toBe("Updated note");
  });
  it("uses epoch+revision CAS across competing writers and preserves current state on conflict", async () => {
    const [a, b] = await Promise.all([open(), open()]);
    const initial = await a.read();
    const outcomes = await Promise.allSettled([
      a.update(initial, (state) => deck(state, "A")),
      b.update(initial, (state) => deck(state, "B")),
    ]);
    expect(
      outcomes.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    const failure = outcomes.find(
      (result) => result.status === "rejected",
    ) as PromiseRejectedResult;
    expect(failure.reason).toBeInstanceOf(CollectionsRevisionConflictError);
    expect(failure.reason.current).toEqual(await a.read());
    expect((await a.read()).revision).toBe(1);
  });
  it("clones mutator results and rejects async, envelope, revision and malformed changes", async () => {
    const store = await open();
    const initial = await store.read();
    let returned: CollectionsState | undefined;
    const result = await store.update(initial, (state) => {
      returned = deck(state);
      return returned;
    });
    returned!.study.decks[0]!.title = "Changed afterward";
    result.study.decks[0]!.title = "Changed result";
    const persisted = await store.read();
    expect(persisted.study.decks[0]!.title).toBe("Private synthetic deck");
    await expect(
      store.update(
        persisted,
        (async (state: CollectionsState) => state) as unknown as (
          state: CollectionsState,
        ) => CollectionsState,
      ),
    ).rejects.toThrow("synchronous");
    await expect(
      store.update(persisted, (state) => ({ ...state, revision: 999 })),
    ).rejects.toThrow("store-owned");
    await expect(
      store.update(persisted, (state) => ({
        ...state,
        journal: { version: 2 } as unknown as JournalEnvelope,
      })),
    ).rejects.toThrow("collections_invalid");
    await expect(
      store.update(persisted, (state) => ({
        ...state,
        study: { ...state.study, entries: [card(state).study.entries[0]!] },
      })),
    ).rejects.toThrow("collections_invalid");
    expect(await store.read()).toEqual(persisted);
  });
  it("restricts valid envelope replacement to the internal CAS boundary", async () => {
    const store = await open();
    const initial = await store.read();
    const envelope: JournalEnvelope = {
      version: 1,
      kdf: {
        name: "PBKDF2-SHA256",
        iterations: 600000,
        salt: btoa("s".repeat(16)),
      },
      iv: btoa("i".repeat(12)),
      ciphertext: btoa("c".repeat(16)),
    };
    await expect(
      store.update(initial, (state) => ({ ...state, journal: envelope })),
    ).rejects.toThrow("store-owned");
    const saved = await replaceJournal(store, initial, envelope);
    envelope.iv = btoa("z".repeat(12));
    expect((await store.read()).journal).toEqual(saved.journal);
    const studied = await store.update(saved, deck);
    expect(studied.journal).toEqual(saved.journal);
    await expect(replaceJournal(store, initial, null)).rejects.toBeInstanceOf(
      CollectionsRevisionConflictError,
    );
  });
  it("rolls back quota failures and can reload before a new attempt", async () => {
    const store = await open();
    const initial = await store.read();
    const put = vi
      .spyOn(IDBObjectStore.prototype, "put")
      .mockImplementationOnce(() => {
        throw new DOMException("Synthetic quota", "QuotaExceededError");
      });
    await expect(store.update(initial, deck)).rejects.toThrow(
      "Synthetic quota",
    );
    put.mockRestore();
    expect(store.persistence().status).toBe("failed");
    expect(await store.read()).toEqual(initial);
    expect((await store.update(initial, deck)).revision).toBe(1);
  });
  it("reloads a committed unknown-result write instead of replaying over it", async () => {
    const store = await open();
    const initial = await store.read();
    const broadcast = vi
      .spyOn(BroadcastChannel.prototype, "postMessage")
      .mockImplementationOnce(() => {
        throw new Error("Synthetic notification failure after commit");
      });
    await expect(store.update(initial, deck)).rejects.toThrow(
      "notification failure",
    );
    broadcast.mockRestore();
    const committed = await store.read();
    expect(committed.revision).toBe(1);
    expect(committed.study.decks).toHaveLength(1);
    await expect(store.update(initial, deck)).rejects.toBeInstanceOf(
      CollectionsRevisionConflictError,
    );
    expect(await store.read()).toEqual(committed);
  });
  it("keeps review history immutable except for the one-way undo marker", async () => {
    const store = await open();
    const first = await store.update(await store.read(), card);
    const reviewed = await store.update(first, (state) => {
      const before = structuredClone(state.study.cards[0]!);
      const target = state.study.cards[0]!;
      target.revision++;
      target.schedule = {
        ...target.schedule,
        state: "review",
        due: "2026-11-12T00:00:00.000Z",
        intervalDays: 1,
        repetitions: 1,
        lastReviewedAt: at,
      };
      state.study.events.push({
        id: crypto.randomUUID(),
        cardId,
        sessionId: crypto.randomUUID(),
        at,
        grade: "good",
        algorithm: "orbyn-interval-v1",
        before: { schedule: before.schedule, cardRevision: before.revision },
        after: {
          schedule: structuredClone(target.schedule),
          cardRevision: target.revision,
        },
        undoneAt: null,
      });
      return state;
    });
    await expect(
      store.update(reviewed, (state) => {
        state.study.events = [];
        return state;
      }),
    ).rejects.toThrow("store-owned");
    await expect(
      store.update(reviewed, (state) => {
        state.study.events[0]!.grade = "easy";
        return state;
      }),
    ).rejects.toThrow("store-owned");
    const undone = await store.update(reviewed, (state) => {
      state.study.events[0]!.undoneAt = at;
      return state;
    });
    await expect(
      store.update(undone, (state) => {
        state.study.events[0]!.undoneAt = null;
        return state;
      }),
    ).rejects.toThrow("store-owned");
  });
  it("closes old handles across same-ID account reauthentication and locks late setup", async () => {
    const store = await open();
    const initial = await store.read();
    establish(identity);
    await expect(store.update(initial, deck)).rejects.toThrow("closed");
    let resume!: () => void;
    const gate = new Promise<void>((resolve) => {
      resume = resolve;
    });
    const sign = crypto.subtle.sign.bind(crypto.subtle);
    vi.spyOn(crypto.subtle, "sign").mockImplementationOnce(
      async (algorithm, key, data) => {
        await gate;
        return sign(algorithm, key, data);
      },
    );
    const opening = openCollectionsStore(identity);
    await vi.waitFor(() => expect(crypto.subtle.sign).toHaveBeenCalled());
    establish(identity);
    resume();
    await expect(opening).rejects.toThrow("closed");
    expect(await (await open()).read()).toEqual(initial);
    await expect(
      openCollectionsStore({ ...identity, accountId: crypto.randomUUID() }),
    ).rejects.toThrow("Sign in");
  });
  it("does not commit a write that was awaiting wrapping crypto when account locks", async () => {
    const store = await open();
    const initial = await store.read();
    let resume!: () => void;
    const gate = new Promise<void>((resolve) => {
      resume = resolve;
    });
    const sign = crypto.subtle.sign.bind(crypto.subtle);
    vi.spyOn(crypto.subtle, "sign").mockImplementationOnce(
      async (algorithm, key, data) => {
        await gate;
        return sign(algorithm, key, data);
      },
    );
    const pending = store.update(initial, deck);
    lock();
    establish(identity);
    resume();
    await expect(pending).rejects.toThrow("closed");
    expect(await (await open()).read()).toEqual(initial);
  });
  it("rejects a stale Notes open before it can become an erase-capable handle", async () => {
    let resume!: () => void;
    const gate = new Promise<void>((resolve) => {
      resume = resolve;
    });
    const original = database.readRecord;
    const reading = vi
      .spyOn(database, "readRecord")
      .mockImplementationOnce(async (store, key) => {
        const value = await original(store, key);
        await gate;
        return value;
      });
    const pending = openNotesStore(identity);
    await vi.waitFor(() => expect(reading).toHaveBeenCalled());
    establish(identity);
    resume();
    await expect(pending).rejects.toThrow("closed");
  });
  it.each(["future", "corrupt"])(
    "fails closed on authenticated %s payload without reset",
    async (kind) => {
      const store = await open();
      const initial = await store.read();
      store.close();
      await writePayload(
        kind === "future"
          ? { ...initial, version: 4 }
          : {
              ...initial,
              study: { ...initial.study, decks: [{ id: deckId }] },
            },
      );
      const before = (await readRecord<DeviceRecord>(
        "devices",
        identity.email,
      ))!.snapshot;
      await expect(openCollectionsStore(identity)).rejects.toThrow(
        "collections_invalid",
      );
      expect(
        (await readRecord<DeviceRecord>("devices", identity.email))!.snapshot,
      ).toEqual(before);
    },
  );
  it("atomically erases Notes and advances the encrypted collections tombstone", async () => {
    const notes = await openNotesStore(identity);
    handles.add(notes);
    await notes.create({
      title: "Erase fixture",
      document: { type: "doc", content: [] },
      tags: [],
    });
    const store = await open();
    const initial = await store.read();
    const old = await store.update(initial, card);
    const before = (await readRecord<DeviceRecord>("devices", identity.email))!;
    const ordering: string[] = [];
    onCollectionsEpochChange(store, () => ordering.push("revoke"));
    store.subscribe(() => ordering.push("publish"));
    await notes.erase();
    const erased = await store.read();
    expect(erased.epoch).not.toBe(old.epoch);
    expect(erased.revision).toBe(old.revision + 1);
    expect(erased.study.decks).toEqual([]);
    expect(erased.journal).toBeNull();
    expect(await notes.list()).toEqual([]);
    expect(ordering[0]).toBe("revoke");
    await expect(store.update(old, card)).rejects.toBeInstanceOf(
      CollectionsRevisionConflictError,
    );
    const after = (await readRecord<DeviceRecord>("devices", identity.email))!;
    expect(after.sealedKeys).toEqual(before.sealedKeys);
    expect(after.verifiedTrust).toBe(true);
    await notes.erase();
    expect((await store.read()).revision).toBe(erased.revision + 1);
  });
  it("rolls back BOTH erase effects when the snapshot transaction fails", async () => {
    const notes = await openNotesStore(identity);
    handles.add(notes);
    const note = await notes.create({
      title: "Retained",
      document: { type: "doc", content: [] },
      tags: [],
    });
    const store = await open();
    const initial = await store.update(await store.read(), card);
    const put = vi
      .spyOn(IDBObjectStore.prototype, "put")
      .mockImplementationOnce(() => {
        throw new DOMException("Synthetic quota", "QuotaExceededError");
      });
    await expect(notes.erase()).rejects.toThrow("Synthetic quota");
    put.mockRestore();
    expect(await notes.get(note.id)).toEqual(note);
    expect(await store.read()).toEqual(initial);
  });
  it("revokes a stale pending Journal replacement and preserves unrelated encrypted zones on erase", async () => {
    const notes = await openNotesStore(identity);
    handles.add(notes);
    const store = await open();
    const initial = await store.read();
    const record = (await readRecord<DeviceRecord>("devices", identity.email))!;
    const secret = await wrappingSecret(record.wrapKey);
    try {
      await mutateRecord<DeviceRecord>("devices", identity.email, (current) => {
        const keys = DeviceKeys.import(current!.sealedKeys, secret);
        const engine = SyncEngine.restore(
          keys,
          current!.snapshot!,
          secret,
          Date.now(),
        );
        try {
          engine.createZoneKey("unrelated-fixture");
          engine.stage(
            "unrelated-fixture",
            "fixture",
            "sentinel",
            JSON.stringify({
              marker: {
                value: "preserve synthetic unrelated zone",
                stamp: JSON.parse(engine.tick(Date.now())),
              },
            }),
          );
          return {
            ...current!,
            snapshot: engine.snapshot(secret),
            generation: current!.generation + 1,
          };
        } finally {
          engine.free();
          keys.free();
        }
      });
      let resume!: () => void;
      const gate = new Promise<void>((resolve) => {
        resume = resolve;
      });
      const sign = crypto.subtle.sign.bind(crypto.subtle);
      vi.spyOn(crypto.subtle, "sign").mockImplementationOnce(
        async (algorithm, key, data) => {
          await gate;
          return sign(algorithm, key, data);
        },
      );
      const envelope: JournalEnvelope = {
        version: 1,
        kdf: {
          name: "PBKDF2-SHA256",
          iterations: 600000,
          salt: btoa("s".repeat(16)),
        },
        iv: btoa("i".repeat(12)),
        ciphertext: btoa("c".repeat(16)),
      };
      const pending = replaceJournal(store, initial, envelope);
      await notes.erase();
      resume();
      await expect(pending).rejects.toBeInstanceOf(
        CollectionsRevisionConflictError,
      );
      expect((await store.read()).journal).toBeNull();
      const final = (await readRecord<DeviceRecord>(
        "devices",
        identity.email,
      ))!;
      const keys = DeviceKeys.import(final.sealedKeys, secret);
      const engine = SyncEngine.restore(
        keys,
        final.snapshot!,
        secret,
        Date.now(),
      );
      try {
        expect(engine.record("unrelated-fixture", "sentinel")).toContain(
          "preserve synthetic unrelated zone",
        );
      } finally {
        engine.free();
        keys.free();
      }
    } finally {
      secret.fill(0);
    }
  });
  it("validates cloze/card namespaces, exact schema, date, preferences and envelope bounds", async () => {
    const state = card(await (await open()).read());
    const invalid = [
      { ...state, unknown: "plaintext" },
      { ...state, revision: -1 },
      {
        ...state,
        study: {
          ...state.study,
          decks: [...state.study.decks, ...state.study.decks],
        },
      },
      {
        ...state,
        study: {
          ...state.study,
          preferences: { ...state.study.preferences, timezone: "Not/AZone" },
        },
      },
      {
        ...state,
        study: {
          ...state.study,
          cards: [{ ...state.study.cards[0]!, key: "reversed:forward" }],
        },
      },
      {
        ...state,
        study: {
          ...state.study,
          cards: [
            {
              ...state.study.cards[0]!,
              schedule: { ...state.study.cards[0]!.schedule, due: "tomorrow" },
            },
          ],
        },
      },
    ];
    for (const value of invalid)
      expect(() => validateCollections(value)).toThrow("collections_invalid");
    const cloze = structuredClone(state);
    cloze.study.entries = [
      {
        id: entryId,
        deckId,
        revision: 1,
        source: null,
        tags: [],
        type: "cloze",
        text: "One {{forward}}",
        blanks: [{ id: "forward", answer: "answer" }],
      },
    ];
    expect(() => validateCollections(cloze)).toThrow();
    cloze.study.cards[0]!.key = "cloze:forward";
    expect(validateCollections(cloze)).toEqual(cloze);
    cloze.study.entries[0] = {
      ...cloze.study.entries[0]!,
      type: "cloze",
      text: "{{forward}} {{forward}}",
      blanks: [{ id: "forward", answer: "answer" }],
    };
    expect(() => validateCollections(cloze)).toThrow();
    expect(() =>
      validateJournalEnvelope({
        version: 1,
        kdf: { name: "PBKDF2-SHA256", iterations: 1, salt: "AA==" },
        iv: "AA==",
        ciphertext: "AA==",
      }),
    ).toThrow();
  });
});
