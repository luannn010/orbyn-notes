// @vitest-environment node
import { beforeAll, beforeEach, afterEach, it, expect, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import { initSync, DeviceKeys } from "../../src/generated/wasm/orbyn_wasm.js";
import {
  openCollectionsStore,
  replaceJournal,
} from "../../src/collections/store";
import {
  CollectionsRevisionConflictError,
  type CollectionsState,
  type CollectionsStore,
  type StudyPreferences,
} from "../../src/collections/contracts";
import {
  newWrappingKey,
  wrappingSecret,
  mutateRecord,
  readRecord,
  type DeviceRecord,
} from "../../src/data/database";
import { establish, lock } from "../../src/account/session";
import {
  createDeck,
  saveEntry,
  gradeCard,
  reviewQueue,
  progress,
} from "../../src/study/model";
import { studyDay } from "../../src/study/scheduler";
import {
  createJournalEnvelope,
  emptyJournal,
} from "../../src/collections/journal";
const identity = {
  accountId: "11111111-1111-4111-8111-111111111111",
  deviceId: "22222222-2222-4222-8222-222222222222",
  email: "study-preferences@example.test",
  deviceState: "trusted" as const,
};
const handles = new Set<CollectionsStore>(),
  createdAt = new Date("2026-11-09T00:00:00Z");
beforeAll(async () =>
  initSync({
    module: await readFile(
      new URL("../../src/generated/wasm/orbyn_wasm_bg.wasm", import.meta.url),
    ),
  }),
);
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
      approvalCheckpointId: "33333333-3333-4333-8333-333333333333",
    }));
  } finally {
    keys.free();
    secret.fill(0);
  }
  establish(identity);
});
afterEach(() => {
  for (const h of handles) h.close();
  handles.clear();
  vi.restoreAllMocks();
  lock();
});
async function open() {
  const store = await openCollectionsStore(identity);
  handles.add(store);
  return store;
}
async function device() {
  return (await readRecord<DeviceRecord>("devices", identity.email))!;
}
async function fixture(journal = false) {
  const store = await open(),
    current = await store.read();
  let state = await store.update(current, (original) => {
    let study = createDeck(original.study, "Settings verification", createdAt);
    for (let i = 0; i < 4; i++)
      study = saveEntry(
        study,
        {
          id: crypto.randomUUID(),
          deckId: study.decks[0]!.id,
          type: "basic",
          front: "PRIVATE-PREFERENCE-QUESTION-" + i,
          back: "Saved answer " + i,
          source: null,
          revision: 1,
          tags: ["settings"],
        },
        createdAt,
      );
    return {
      ...original,
      study: {
        ...study,
        preferences: { ...study.preferences, timezone: "UTC" },
      },
      clips: {
        ...original.clips,
        items: [
          {
            id: crypto.randomUUID(),
            revision: 1,
            title: "Preserve real Clip",
            originalUrl: "https://example.test/settings",
            canonicalUrl: "https://example.test/settings",
            text: "PRIVATE-PREFERENCE-CLIP-TEXT",
            createdAt: createdAt.toISOString(),
            updatedAt: createdAt.toISOString(),
            readLater: false,
            readAt: null,
            archivedAt: createdAt.toISOString(),
          },
        ],
      },
    };
  });
  if (journal) {
    const envelope = await createJournalEnvelope(
      "synthetic preferences test passphrase",
      emptyJournal(),
      { accountId: identity.accountId, epoch: state.epoch },
      () => {},
    );
    state = await replaceJournal(store, state, envelope.envelope);
  }
  return { store, state };
}
function unrelated(state: CollectionsState) {
  const { preferences, ...study } = state.study;
  void preferences;
  return { ...state, revision: 0, study };
}
it("commits all five real preferences, reopens them, and preserves schedules/events/Clips/Journal/identity", async () => {
  const f = await fixture(true),
    first = f.state.study.cards[0]!,
    sessionId = crypto.randomUUID(),
    operationId = crypto.randomUUID();
  const before = await f.store.update(f.state, (current) => ({
      ...current,
      study: gradeCard(
        current.study,
        first.id,
        "good",
        sessionId,
        operationId,
        new Date("2026-11-10T03:30:00Z"),
      ),
    })),
    recordBefore = await device(),
    saved = await f.store.update(before, (current) => ({
      ...current,
      study: {
        ...current.study,
        preferences: {
          ...current.study.preferences,
          newPerDay: 7,
          reviewsPerDay: 73,
          dayStartHour: 2,
          showNextReview: false,
          showStreak: false,
        },
      },
    }));
  expect(saved.study.preferences).toEqual({
    ...before.study.preferences,
    newPerDay: 7,
    reviewsPerDay: 73,
    dayStartHour: 2,
    showNextReview: false,
    showStreak: false,
  });
  expect(unrelated(saved)).toEqual(unrelated(before));
  expect(saved.revision).toBe(before.revision + 1);
  expect(saved.journal).not.toBeNull();
  f.store.close();
  const reopened = await open();
  expect(await reopened.read()).toEqual(saved);
  const recordAfter = await device();
  expect(recordAfter.accountId).toBe(recordBefore.accountId);
  expect(recordAfter.deviceId).toBe(recordBefore.deviceId);
  expect(recordAfter.sealedKeys).toEqual(recordBefore.sealedKeys);
  expect(recordBefore.approvalCheckpointId).toBe(
    "33333333-3333-4333-8333-333333333333",
  );
  expect(recordAfter.approvalCheckpointId).toBe(
    recordBefore.approvalCheckpointId,
  );
  expect(recordAfter.verifiedTrust).toBe(recordBefore.verifiedTrust);
  expect(recordAfter.generation).toBe(recordBefore.generation + 1);
  const bytes = new TextDecoder().decode(recordAfter.snapshot);
  expect(bytes).not.toContain("PRIVATE-PREFERENCE-QUESTION");
  expect(bytes).not.toContain("PRIVATE-PREFERENCE-CLIP-TEXT");
});
it.each([
  { newPerDay: 0, reviewsPerDay: 0, dayStartHour: 0 },
  { newPerDay: 10000, reviewsPerDay: 20000, dayStartHour: 23 },
])(
  "admits exact existing numeric preference boundaries $newPerDay/$reviewsPerDay/$dayStartHour",
  async (patch) => {
    const f = await fixture(),
      saved = await f.store.update(f.state, (current) => ({
        ...current,
        study: {
          ...current.study,
          preferences: {
            ...current.study.preferences,
            ...patch,
            showNextReview: false,
            showStreak: false,
          },
        },
      }));
    expect(saved.study.preferences).toMatchObject(patch);
    expect(saved.study.preferences.timezone).toBe("UTC");
    expect(saved.study.preferences.algorithm).toBe("orbyn-interval-v1");
    expect(unrelated(saved)).toEqual(unrelated(f.state));
    expect((await (await open()).read()).study.preferences).toEqual(
      saved.study.preferences,
    );
  },
);
it.each<[keyof StudyPreferences, unknown]>([
  ["newPerDay", -1],
  ["newPerDay", 10001],
  ["newPerDay", 0.5],
  ["reviewsPerDay", -1],
  ["reviewsPerDay", 20001],
  ["reviewsPerDay", 1.5],
  ["dayStartHour", -1],
  ["dayStartHour", 24],
  ["dayStartHour", 4.5],
  ["showNextReview", "false"],
  ["showStreak", 0],
])(
  "rejects invalid runtime %s=%s without changing durable state",
  async (key, value) => {
    const f = await fixture(),
      before = await device();
    await expect(
      f.store.update(f.state, (current) => ({
        ...current,
        study: {
          ...current.study,
          preferences: { ...current.study.preferences, [key]: value },
        },
      })),
    ).rejects.toThrow("collections_invalid");
    const after = await device();
    expect(after.snapshot).toEqual(before.snapshot);
    expect(after.generation).toBe(before.generation);
    expect(await f.store.read()).toEqual(f.state);
  },
);
it("rejects stale settings CAS and explicit dirty-subset retry preserves a winning grade and unrelated preference/Clip", async () => {
  const f = await fixture(true),
    other = await open(),
    operationId = crypto.randomUUID(),
    sessionId = crypto.randomUUID(),
    at = new Date("2026-11-11T04:58:00Z"),
    card = f.state.study.cards[0]!;
  const winner = await other.update(f.state, (current) => ({
    ...current,
    study: {
      ...gradeCard(current.study, card.id, "again", sessionId, operationId, at),
      preferences: { ...current.study.preferences, showStreak: false },
    },
    clips: {
      ...current.clips,
      items: current.clips.items.map((clip) => ({
        ...clip,
        readLater: true,
        revision: clip.revision + 1,
      })),
    },
  }));
  await expect(
    f.store.update(f.state, (current) => ({
      ...current,
      study: {
        ...current.study,
        preferences: { ...current.study.preferences, newPerDay: 2 },
      },
    })),
  ).rejects.toBeInstanceOf(CollectionsRevisionConflictError);
  const latest = await f.store.read(),
    saved = await f.store.update(latest, (current) => ({
      ...current,
      study: {
        ...current.study,
        preferences: { ...current.study.preferences, newPerDay: 2 },
      },
    }));
  expect(saved.study.preferences.showStreak).toBe(false);
  expect(saved.study.preferences.newPerDay).toBe(2);
  expect(saved.study.cards).toEqual(winner.study.cards);
  expect(saved.study.events).toEqual(winner.study.events);
  expect(
    saved.study.events.filter((event) => event.id === operationId),
  ).toHaveLength(1);
  expect(saved.clips).toEqual(winner.clips);
  expect(saved.journal).toEqual(winner.journal);
});
it("a winning settings commit does not create a grade and stale grade retries keep one captured intent", async () => {
  const f = await fixture(),
    other = await open(),
    card = f.state.study.cards[0]!,
    operationId = crypto.randomUUID(),
    sessionId = crypto.randomUUID(),
    at = new Date("2026-11-11T03:30:00Z");
  const settings = await f.store.update(f.state, (current) => ({
    ...current,
    study: {
      ...current.study,
      preferences: {
        ...current.study.preferences,
        dayStartHour: 0,
        newPerDay: 0,
      },
    },
  }));
  expect(settings.study.events).toEqual([]);
  expect(settings.study.cards).toEqual(f.state.study.cards);
  await expect(
    other.update(f.state, (current) => ({
      ...current,
      study: gradeCard(
        current.study,
        card.id,
        "again",
        sessionId,
        operationId,
        at,
      ),
    })),
  ).rejects.toBeInstanceOf(CollectionsRevisionConflictError);
  const latest = await other.read(),
    graded = await other.update(latest, (current) => ({
      ...current,
      study: gradeCard(
        current.study,
        card.id,
        "again",
        sessionId,
        operationId,
        at,
      ),
    }));
  expect(graded.study.events).toHaveLength(1);
  expect(graded.study.events[0]).toMatchObject({
    id: operationId,
    at: at.toISOString(),
    sessionId,
    grade: "again",
  });
  expect(graded.study.preferences).toEqual(settings.study.preferences);
  const replay = await other.update(graded, (current) => ({
    ...current,
    study: gradeCard(
      current.study,
      card.id,
      "again",
      sessionId,
      operationId,
      at,
    ),
  }));
  expect(replay.study.events).toEqual(graded.study.events);
  expect(replay.study.cards).toEqual(graded.study.cards);
});
it("failed local transaction keeps physical sealed bytes and all five committed values unchanged", async () => {
  const f = await fixture(true),
    before = await device(),
    put = vi
      .spyOn(IDBObjectStore.prototype, "put")
      .mockImplementationOnce(() => {
        throw new DOMException(
          "Synthetic preferences quota",
          "QuotaExceededError",
        );
      });
  await expect(
    f.store.update(f.state, (current) => ({
      ...current,
      study: {
        ...current.study,
        preferences: {
          ...current.study.preferences,
          newPerDay: 1,
          reviewsPerDay: 2,
          dayStartHour: 23,
          showNextReview: false,
          showStreak: false,
        },
      },
    })),
  ).rejects.toThrow("Synthetic preferences quota");
  put.mockRestore();
  const after = await device();
  expect(after.snapshot).toEqual(before.snapshot);
  expect(after.generation).toBe(before.generation);
  expect(after.sealedKeys).toEqual(before.sealedKeys);
  expect(await f.store.read()).toEqual(f.state);
  expect(await (await open()).read()).toEqual(f.state);
});
it("next normal queue uses new caps without rescheduling and due admitted learning repeats remain available at zero", async () => {
  const f = await fixture(),
    now = new Date("2026-11-11T05:00:00Z"),
    initial = reviewQueue(f.state.study, now);
  expect(initial).toHaveLength(4);
  const one = await f.store.update(f.state, (current) => ({
    ...current,
    study: {
      ...current.study,
      preferences: {
        ...current.study.preferences,
        newPerDay: 1,
        reviewsPerDay: 0,
      },
    },
  }));
  expect(reviewQueue(one.study, now)).toHaveLength(1);
  expect(one.study.cards).toEqual(f.state.study.cards);
  expect(one.study.events).toEqual(f.state.study.events);
  const card = one.study.cards[0]!,
    graded = await f.store.update(one, (current) => ({
      ...current,
      study: gradeCard(
        current.study,
        card.id,
        "again",
        crypto.randomUUID(),
        crypto.randomUUID(),
        new Date("2026-11-11T04:58:00Z"),
      ),
    }));
  const zero = await f.store.update(graded, (current) => ({
    ...current,
    study: {
      ...current.study,
      preferences: {
        ...current.study.preferences,
        newPerDay: 0,
        reviewsPerDay: 0,
      },
    },
  }));
  expect(reviewQueue(zero.study, now).map((card) => card.id)).toEqual([
    card.id,
  ]);
  expect(zero.study.cards).toEqual(graded.study.cards);
  expect(zero.study.events).toEqual(graded.study.events);
});
it("day-start regroups derived streak from immutable review timestamps without changing actual schedule/event history", async () => {
  const f = await fixture(),
    at = new Date("2026-11-10T03:30:00Z"),
    now = new Date("2026-11-11T05:00:00Z"),
    card = f.state.study.cards[0]!,
    before = await f.store.update(f.state, (current) => ({
      ...current,
      study: gradeCard(
        current.study,
        card.id,
        "good",
        crypto.randomUUID(),
        crypto.randomUUID(),
        at,
      ),
    }));
  expect(studyDay(at, "UTC", 4)).toBe("2026-11-09");
  expect(progress(before.study, now).streak).toBe(0);
  const after = await f.store.update(before, (current) => ({
    ...current,
    study: {
      ...current.study,
      preferences: { ...current.study.preferences, dayStartHour: 0 },
    },
  }));
  expect(
    studyDay(
      new Date(after.study.events[0]!.at),
      after.study.preferences.timezone,
      after.study.preferences.dayStartHour,
    ),
  ).toBe("2026-11-10");
  expect(progress(after.study, now).streak).toBe(1);
  expect(after.study.cards).toEqual(before.study.cards);
  expect(after.study.events).toEqual(before.study.events);
  expect(after.study.preferences.timezone).toBe(
    before.study.preferences.timezone,
  );
});
it("day-start changes next-queue admission grouping but never rewrites an already reviewed card", async () => {
  const f = await fixture(),
    at = new Date("2026-11-11T03:30:00Z"),
    now = new Date("2026-11-11T05:00:00Z"),
    card = f.state.study.cards[0]!,
    before = await f.store.update(f.state, (current) => ({
      ...current,
      study: {
        ...gradeCard(
          current.study,
          card.id,
          "again",
          crypto.randomUUID(),
          crypto.randomUUID(),
          at,
        ),
        preferences: {
          ...current.study.preferences,
          newPerDay: 1,
          reviewsPerDay: 0,
          dayStartHour: 4,
        },
      },
    }));
  const old = reviewQueue(before.study, now);
  expect(old).toHaveLength(1);
  expect(old[0]!.id).not.toBe(card.id);
  const after = await f.store.update(before, (current) => ({
    ...current,
    study: {
      ...current.study,
      preferences: { ...current.study.preferences, dayStartHour: 0 },
    },
  }));
  expect(reviewQueue(after.study, now).map((item) => item.id)).toEqual([
    card.id,
  ]);
  expect(after.study.cards).toEqual(before.study.cards);
  expect(after.study.events).toEqual(before.study.events);
});

it("review admission caps change the next due-review queue without touching stored schedules", async () => {
  const f = await fixture(),
    now = new Date("2026-11-11T05:00:00Z"),
    reviewed = await f.store.update(f.state, (current) => {
      let study = current.study;
      const sessionId = crypto.randomUUID();
      for (const card of current.study.cards)
        study = gradeCard(
          study,
          card.id,
          "good",
          sessionId,
          crypto.randomUUID(),
          createdAt,
        );
      return {
        ...current,
        study: {
          ...study,
          preferences: { ...study.preferences, newPerDay: 0, reviewsPerDay: 2 },
        },
      };
    });
  expect(reviewQueue(reviewed.study, now)).toHaveLength(2);
  const zero = await f.store.update(reviewed, (current) => ({
    ...current,
    study: {
      ...current.study,
      preferences: { ...current.study.preferences, reviewsPerDay: 0 },
    },
  }));
  expect(reviewQueue(zero.study, now)).toHaveLength(0);
  expect(zero.study.cards).toEqual(reviewed.study.cards);
  expect(zero.study.events).toEqual(reviewed.study.events);
  const four = await f.store.update(zero, (current) => ({
    ...current,
    study: {
      ...current.study,
      preferences: { ...current.study.preferences, reviewsPerDay: 4 },
    },
  }));
  expect(reviewQueue(four.study, now)).toHaveLength(4);
  expect(four.study.cards).toEqual(reviewed.study.cards);
  expect(four.study.events).toEqual(reviewed.study.events);
});
