import { expect, it, vi } from "vitest";
import { LiteralMatcher, splitSearchText, type ChunkMatch } from "../../src/search/matching";
import { compileSearchQuery } from "../../src/search/text";
import { SearchWork } from "../../src/search/work";

async function scan(query: string, pieces: readonly (string | null)[]) {
  const matcher = new LiteralMatcher(compileSearchQuery(query)!);
  const results: ChunkMatch[] = [];
  const run = async (iterator: ReturnType<LiteralMatcher["push"]>) => {
    const work = new SearchWork(iterator, undefined, async () => {});
    const result = await work.round();
    if (result.status !== "done") throw new Error("Unexpected pause");
    results.push(result.value);
  };
  for (const piece of pieces) {
    if (piece === null) {
      await run(matcher.finish());
      matcher.boundary();
    } else await run(matcher.push(piece));
  }
  await run(matcher.finish());
  return {
    mask: results.reduce((mask, part) => mask | part.mask, 0),
    excerpts: results.flatMap((part) => (part.excerpt ? [part.excerpt] : [])),
  };
}

it("normalizes adjacent nodes before emitting their final starter", async () => {
  const result = await scan("é", ["e", "\u0301"]);
  expect(result.mask).toBe(1);
  expect(result.excerpts).toEqual([
    {
      text: "e\u0301",
      matches: [{ from: 0, to: 2 }],
      before: false,
      after: false,
    },
  ]);
  expect((await scan("e", ["e", "\u0301"])).mask).toBe(0);
  expect((await scan("é", ["e", null, "\u0301"])).mask).toBe(0);
});

it("keeps direct 4096-unit input equivalent to split nodes", async () => {
  const result = await scan("é", ["x".repeat(4094) + "e\u0301"]);
  expect(result.mask).toBe(1);
  const excerpt = result.excerpts[0]!;
  expect(excerpt.matches.map(range => excerpt.text.slice(range.from, range.to))).toEqual(["e\u0301"]);
});

it.each([
  ["\u1e69", ["s", "\u0307", "\u0323"]],
  ["각", ["\u1100", "\u1161", "\u11a8"]],
  ["각", ["가", "\u11a8"]],
  ["\u{16D63}\u{16D67}".normalize("NFC"), ["\u{16D63}", "\u{16D67}"]],
])(
  "normalizes reordered marks and non-mark compositions: %s",
  async (query, pieces) => {
    expect((await scan(query, pieces)).mask).toBe(1);
  },
);

it("rejects an oversized unfinished cluster instead of reporting a false negative", async () => {
  const normalize = String.prototype.normalize;
  const lengths: number[] = [];
  const spy = vi
    .spyOn(String.prototype, "normalize")
    .mockImplementation(function (this: string, form) {
      lengths.push(this.length);
      return normalize.call(this, form);
    });
  try {
    await expect(
      scan("é", ["e" + "\u0301".repeat(4095), "\u0323"]),
    ).rejects.toThrow(/oversized indivisible/);
    expect(lengths.every((length) => length <= 4096)).toBe(true);
  } finally {
    spy.mockRestore();
  }
});

it("finishes a limit-sized cluster with balanced reservations", async () => {
  expect((await scan("é", ["e" + "\u0301".repeat(4095), "x"])).mask).toBe(1);
});

it("resumes normalization at the same reservation without duplicate evidence", async () => {
  const matcher = new LiteralMatcher(compileSearchQuery("é")!);
  const work = new SearchWork(
    (function* () {
      yield* matcher.push("e");
      yield* matcher.push("\u0301");
      return yield* matcher.finish();
    })(),
    { bytes: 120_000, visits: 1 },
    async () => {},
  );
  let pauses = 0;
  for (;;) {
    const result = await work.round();
    if (result.status === "done") {
      expect(result.value.mask).toBe(1);
      expect(result.value.excerpt?.matches).toEqual([{ from: 0, to: 2 }]);
      break;
    }
    pauses++;
    expect(pauses).toBeLessThan(20);
  }
  expect(pauses).toBeGreaterThan(0);
});

it("accounts for boundary inspections without charging the full source twice", async () => {
  const matcher = new LiteralMatcher(compileSearchQuery("needle")!);
  const source = "x".repeat(3994) + "needle";
  const work = new SearchWork((function* () {
    const pushed = yield* matcher.push(source);
    const finished = yield* matcher.finish();
    return pushed.mask | finished.mask;
  })(), undefined, async () => {});
  const result = await work.round();
  expect(result.status).toBe("done");
  if (result.status !== "done") throw new Error("Unexpected pause");
  expect(result.value).toBe(1);
  expect(result.used.scalars).toBeGreaterThan(source.length);
  expect(result.used.scalars).toBeLessThanOrEqual(source.length + 4);
});

it("keeps ASCII case folding exact around non-letter punctuation", async () => {
  expect((await scan("az[]@`", ["A", "Z[]@`"])).mask).toBe(1);
  expect((await scan("az[]@`", ["AZ{}@`"])).mask).toBe(0);
});

it("flushes a deferred stable batch before separating semantic neighbours", async () => {
  const result = await scan("needle", ["need", "le", null, "other"]);
  expect(result.mask).toBe(1);
  expect(result.excerpts[0]).toEqual({ text: "needle", matches: [{ from: 0, to: 6 }], before: false, after: false });
  expect((await scan("needle", ["need", null, "le"])).mask).toBe(0);
});

it("keeps a complete normalization cluster across the stable-batch threshold", async () => {
  const result = await scan("é", ["x".repeat(1023) + "e", "\u0301", "z"]);
  expect(result.mask).toBe(1);
  const excerpt = result.excerpts[0]!;
  expect(excerpt.matches.map(range => excerpt.text.slice(range.from, range.to))).toEqual(["e\u0301"]);
});

it("keeps a split astral scalar intact across the stable-batch threshold", async () => {
  const result = await scan("\u{10428}", ["x".repeat(1023) + "\ud801", "\udc00", "z"]);
  expect(result.mask).toBe(1);
  const excerpt = result.excerpts[0]!;
  expect(excerpt.matches.map(range => excerpt.text.slice(range.from, range.to))).toEqual(["\u{10400}"]);
});

it("splits transport descriptors without inspecting normalization clusters", () => {
  const source = "e" + "\u0301".repeat(10_000);
  const spy = vi.spyOn(String.prototype, "codePointAt");
  try {
    const chunks = [...splitSearchText(source)];
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0]?.from).toBe(0);
    expect(chunks.at(-1)?.to).toBe(source.length);
    expect(spy).not.toHaveBeenCalled();
  } finally {
    spy.mockRestore();
  }
});

it("resumes deferred stable batches with one final match and original excerpt", async () => {
  const matcher = new LiteralMatcher(compileSearchQuery("needle")!);
  const work = new SearchWork((function* () {
    let mask = 0;
    const excerpts = [];
    for (const part of [...Array<string>(1100).fill("x"), "need", "le"]) {
      const result = yield* matcher.push(part);
      mask |= result.mask;
      if (result.excerpt) excerpts.push(result.excerpt);
    }
    const ended = yield* matcher.finish();
    mask |= ended.mask;
    if (ended.excerpt) excerpts.push(ended.excerpt);
    return { mask, excerpts };
  })(), { bytes: 2_000_000, visits: 5 }, async () => {});
  let pauses = 0;
  for (;;) {
    const result = await work.round();
    expect(result.used.visits).toBeLessThanOrEqual(5);
    expect(result.used.bytes).toBeLessThanOrEqual(2_000_000);
    if (result.status === "done") {
      expect(result.value.mask).toBe(1);
      expect(result.value.excerpts).toHaveLength(1);
      const excerpt = result.value.excerpts[0]!;
      expect(excerpt.matches.map(range => excerpt.text.slice(range.from, range.to))).toEqual(["needle"]);
      break;
    }
    expect(++pauses).toBeLessThan(500);
  }
  expect(pauses).toBeGreaterThan(200);
});
