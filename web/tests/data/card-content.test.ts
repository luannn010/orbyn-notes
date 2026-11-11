// @vitest-environment node
import { it, expect } from "vitest";
import {
  buildCardContent,
  readCardContentPage,
  disposeCardContent,
  type CardContentInput,
  type CardContentReader,
  type CardContentSide,
} from "../../src/study/cardContent";
import { SearchWork, type WorkEvent } from "../../src/search/work";
import { cardText } from "../../src/study/model";
import type { StudyEntry } from "../../src/collections/contracts";
async function done<T>(iterator: Generator<WorkEvent, T, void>) {
  const job = new SearchWork(iterator, undefined, async () => {});
  for (let round = 0; round < 100; round++) {
    const result = await job.round();
    if (result.status === "done") return result.value;
  }
  throw new Error("Unexpected noncompletion.");
}
async function all(reader: CardContentReader, side: CardContentSide) {
  let page = await done(readCardContentPage(reader, side)),
    text = page.text,
    pages = 1;
  expect(page.text.length).toBeLessThanOrEqual(16384);
  while (page.next) {
    const next = await done(readCardContentPage(reader, side, page.next));
    expect(next.start).toBe(page.end);
    expect(next.text.length).toBeLessThanOrEqual(16384);
    expect(next.end - next.start).toBe(next.text.length);
    if (page.text.length && next.text.length)
      expect(
        !(
          page.text.charCodeAt(page.text.length - 1) >= 0xd800 &&
          page.text.charCodeAt(page.text.length - 1) <= 0xdbff &&
          next.text.charCodeAt(0) >= 0xdc00 &&
          next.text.charCodeAt(0) <= 0xdfff
        ),
      ).toBe(true);
    text += next.text;
    page = next;
    pages++;
  }
  expect(text.length).toBe(page.total);
  return { text, pages };
}
function golden(input: CardContentInput) {
  const entry = {
    id: "11111111-1111-4111-8111-111111111111",
    deckId: "22222222-2222-4222-8222-222222222222",
    revision: 1,
    tags: [],
    source: null,
    ...input,
  } as StudyEntry;
  return cardText(entry, input.key);
}
it.each<CardContentInput>([
  {
    type: "basic",
    key: "basic:forward",
    front: "<strong>actual</strong>\n question",
    back: "Actual\tanswer",
  },
  {
    type: "reversed",
    key: "reversed:forward",
    front: "Original question",
    back: "Original answer",
  },
  {
    type: "reversed",
    key: "reversed:reverse",
    front: "Original question",
    back: "Original answer",
  },
  {
    type: "cloze",
    key: "cloze:one",
    text: "{literal} {{{one}}} then {other} {{two}}",
    blanks: [
      { id: "one", answer: "FIRST" },
      { id: "two", answer: "SECOND" },
    ],
  },
  {
    type: "cloze",
    key: "cloze:two",
    text: "{literal} {{{one}}} then {other} {{two}}",
    blanks: [
      { id: "one", answer: "FIRST" },
      { id: "two", answer: "SECOND" },
    ],
  },
])(
  "matches actual cardText direction without mutation: $type/$key",
  async (input) => {
    const before = JSON.stringify(input),
      reader = await done(buildCardContent(input));
    try {
      const expected = golden(input);
      expect((await all(reader, "front")).text).toBe(expected.front);
      expect((await all(reader, "back")).text).toBe(expected.back);
      expect(JSON.stringify(input)).toBe(before);
    } finally {
      disposeCardContent(reader);
    }
  },
);
it("makes the full legal100answer×100000 expansion reachable through bounded current pages", async () => {
  const input: CardContentInput = {
      type: "cloze",
      key: "cloze:b50",
      text: Array.from({ length: 100 }, (_, i) => "{{b" + i + "}}").join(" / "),
      blanks: Array.from({ length: 100 }, (_, i) => ({
        id: "b" + i,
        answer: String(i % 10).repeat(100000),
      })),
    },
    reader = await done(buildCardContent(input));
  try {
    const expected = golden(input),
      front = await all(reader, "front"),
      back = await all(reader, "back");
    expect(front.text).toBe(expected.front);
    expect(back.text).toBe(expected.back);
    expect(back.pages).toBeGreaterThan(600);
    expect(front.pages).toBeGreaterThan(600);
  } finally {
    disposeCardContent(reader);
  }
}, 15000);
it("preserves exact Previous/Next ranges with independent front/back and reader cursor affinity", async () => {
  const input: CardContentInput = {
      type: "basic",
      key: "basic:forward",
      front: "f".repeat(50000),
      back: "b".repeat(40000),
    },
    a = await done(buildCardContent(input)),
    b = await done(buildCardContent(input));
  try {
    const first = await done(readCardContentPage(a, "front")),
      second = await done(readCardContentPage(a, "front", first.next!)),
      again = await done(readCardContentPage(a, "front", second.previous!));
    expect(again).toMatchObject({
      text: first.text,
      start: first.start,
      end: first.end,
      total: first.total,
    });
    expect((await done(readCardContentPage(a, "back"))).start).toBe(0);
    await expect(
      done(readCardContentPage(a, "back", first.next!)),
    ).rejects.toThrow();
    await expect(
      done(readCardContentPage(b, "front", first.next!)),
    ).rejects.toThrow();
    await expect(
      done(readCardContentPage(a, "front", {} as never)),
    ).rejects.toThrow();
    await expect(
      done(readCardContentPage(a, "front", null as never)),
    ).rejects.toThrow();
  } finally {
    disposeCardContent(a);
    disposeCardContent(b);
  }
});
it("does not split valid surrogate pairs at pages or literal/answer joins, and keeps actual lone units", async () => {
  const inputs: CardContentInput[] = [
    {
      type: "basic",
      key: "basic:forward",
      front: "x".repeat(16383) + "😀tail",
      back: "lone\uD800x\uDC00literal",
    },
    {
      type: "cloze",
      key: "cloze:two",
      text: "x".repeat(16383) + "\uD83D{{one}} then {{two}}",
      blanks: [
        { id: "one", answer: "\uDE00tail" },
        { id: "two", answer: "actual" },
      ],
    },
  ];
  for (const input of inputs) {
    const reader = await done(buildCardContent(input));
    try {
      const expected = golden(input);
      expect((await all(reader, "front")).text).toBe(expected.front);
      expect((await all(reader, "back")).text).toBe(expected.back);
      const back = await done(readCardContentPage(reader, "back"));
      if (input.type === "cloze") expect(back.end).toBe(16383);
    } finally {
      disposeCardContent(reader);
    }
  }
});
it("captures only whitelisted scalars before suspension, without retaining caller entry/blank objects", async () => {
  const input = {
    type: "cloze" as const,
    key: "cloze:one" as const,
    text: "{{one}} then {{two}}",
    blanks: [
      { id: "one", answer: "ORIGINAL" },
      { id: "two", answer: "SECOND" },
    ],
    get source(): never {
      throw new Error("source quote must never be read");
    },
    schedule: { nextReviewAt: "never" },
  };
  const iterator = buildCardContent(input);
  expect(iterator.next().value).toMatchObject({ type: "reserve" });
  expect(iterator.next().value).toMatchObject({ type: "settle" });
  input.blanks[0]!.answer = "MUTATED";
  input.text = "MUTATED";
  const reader = await done(iterator);
  try {
    expect((await all(reader, "back")).text).toBe("ORIGINAL then SECOND");
    expect(input.schedule.nextReviewAt).toBe("never");
  } finally {
    disposeCardContent(reader);
  }
});
it("rejects mismatched directions, corrupt markers/memberships and producer-bound overflow", async () => {
  const cases: unknown[] = [
    { type: "basic", key: "reversed:reverse", front: "f", back: "b" },
    { type: "reversed", key: "basic:forward", front: "f", back: "b" },
    {
      type: "basic",
      key: "basic:forward",
      front: "x".repeat(100001),
      back: "b",
    },
    ...[
      {
        text: "{{one}}",
        key: "cloze:missing",
        blanks: [{ id: "one", answer: "A" }],
      },
      {
        text: "{{one}} {{one}}",
        key: "cloze:one",
        blanks: [{ id: "one", answer: "A" }],
      },
      {
        text: "{{one}} {{other}}",
        key: "cloze:one",
        blanks: [{ id: "one", answer: "A" }],
      },
      {
        text: "{{one}} {{",
        key: "cloze:one",
        blanks: [{ id: "one", answer: "A" }],
      },
      {
        text: "{{{one}}{",
        key: "cloze:one",
        blanks: [{ id: "one", answer: "A" }],
      },
      {
        text: "{{one}}",
        key: "cloze:one",
        blanks: [
          { id: "one", answer: "A" },
          { id: "one", answer: "B" },
        ],
      },
      {
        text: "{{one}}",
        key: "cloze:one",
        blanks: [{ id: "one", answer: "   " }],
      },
      {
        text: "{{one}}",
        key: "cloze:one",
        blanks: [
          { id: "one", answer: "A" },
          { id: "two", answer: "B" },
        ],
      },
    ].map((value) => ({ type: "cloze", ...value })),
  ];
  for (const input of cases)
    await expect(
      done(buildCardContent(input as CardContentInput)),
    ).rejects.toThrow();
});
it("resumes deliberate low-budget build/page rounds, supports cancel, and retires held page on disposal", async () => {
  const input: CardContentInput = {
      type: "cloze",
      key: "cloze:one",
      text: "x".repeat(90000) + "{{one}}",
      blanks: [{ id: "one", answer: "a".repeat(100000) }],
    },
    job = new SearchWork(
      buildCardContent(input),
      { bytes: 200000, visits: 1000 },
      async () => {},
    );
  expect((await job.round()).status).toBe("paused");
  let reader: CardContentReader | undefined;
  for (let i = 0; i < 100; i++) {
    const result = await job.round();
    if (result.status === "done") {
      reader = result.value;
      break;
    }
  }
  expect(reader).toBeDefined();
  try {
    const work = new SearchWork(
      readCardContentPage(reader!, "back"),
      { bytes: 40000, visits: 1000 },
      async () => {},
    );
    expect((await work.round()).status).toBe("paused");
    let text: string | undefined;
    for (let i = 0; i < 100; i++) {
      const result = await work.round();
      if (result.status === "done") {
        text = result.value.text;
        break;
      }
    }
    expect(text).toBe("x".repeat(16384));
    const held = readCardContentPage(reader!, "back");
    expect(held.next().done).toBe(false);
    disposeCardContent(reader!);
    expect(held.next()).toMatchObject({ done: true });
    expect(() => readCardContentPage(reader!, "back")).toThrow();
    disposeCardContent(reader!);
    const cancel = new SearchWork(
      buildCardContent(input),
      { bytes: 200000, visits: 1000 },
      async () => {},
    );
    expect((await cancel.round()).status).toBe("paused");
    cancel.close();
    await expect(cancel.round()).rejects.toMatchObject({ name: "AbortError" });
    expect(() => disposeCardContent({} as never)).toThrow();
  } finally {
    disposeCardContent(reader!);
  }
});

it("aborts held generation work before any reader/page publication", async () => {
  const input: CardContentInput = {
      type: "basic",
      key: "basic:forward",
      front: "f".repeat(100000),
      back: "b".repeat(100000),
    },
    signal = new AbortController();
  const build = new SearchWork(buildCardContent(input), undefined, async () =>
    signal.abort(),
  );
  await expect(build.round(signal.signal)).rejects.toMatchObject({
    name: "AbortError",
  });
  const reader = await done(buildCardContent(input));
  let current = true;
  try {
    const page = new SearchWork(
      readCardContentPage(reader, "back"),
      undefined,
      async () => {
        current = false;
      },
      () => {
        if (!current) throw new Error("retired generation");
      },
    );
    await expect(page.round()).rejects.toThrow("retired generation");
    expect((await done(readCardContentPage(reader, "back"))).text.length).toBe(
      16384,
    );
  } finally {
    disposeCardContent(reader);
  }
});
it("renders every actual cloze direction with the selected answer hidden only on front", async () => {
  const text = "{{a}} then {{b}} then {{c}}",
    blanks = [
      { id: "a", answer: "ONE" },
      { id: "b", answer: "TWO" },
      { id: "c", answer: "THREE" },
    ];
  for (const blank of blanks) {
    const input: CardContentInput = {
        type: "cloze",
        key: `cloze:${blank.id}`,
        text,
        blanks,
      },
      reader = await done(buildCardContent(input));
    try {
      const expected = golden(input);
      expect((await all(reader, "front")).text).toBe(expected.front);
      expect((await all(reader, "back")).text).toBe(expected.back);
    } finally {
      disposeCardContent(reader);
    }
  }
});
