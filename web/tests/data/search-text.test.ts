import { describe, expect, it } from "vitest";
import { compileSearchQuery, SearchQueryError } from "../../src/search/text";
import { LiteralMatcher, splitSearchText } from "../../src/search/matching";
import { SearchWork } from "../../src/search/work";

describe("Unicode literal query contract", () => {
  it.each([
    ["Straße ẞ STRASSE", ["strasse", "ss"]],
    ["Σ σ ς", ["σ"]],
    ["I İ ı", ["i", "i\u0307", "ı"]],
    ["CAFÉ cafe\u0301", ["café", "cafe\u0301"]],
    ["\u{10400} \u{10428}", ["\u{10428}"]],
    ["ﬃ FFI <script>", ["ffi", "<script>"]],
  ])("folds %s with pinned default full mappings", (input, terms) => {
    expect(compileSearchQuery(input)?.terms).toEqual(terms);
  });
  it("keeps raw input, deduplicates before the term limit, and treats blank as idle", () => {
    expect(compileSearchQuery("  Lisbon  LISBON \n costs ")?.raw).toBe("  Lisbon  LISBON \n costs ");
    expect(compileSearchQuery("word ".repeat(20))?.terms).toEqual(["word"]);
    expect(compileSearchQuery(" \t\n ")).toBe(null);
  });
  it("rejects oversized, incomplete or too-many-term input without truncation", () => {
    expect(compileSearchQuery("😀".repeat(100))?.raw.length).toBe(200);
    for (const [value, code] of [["a".repeat(201), "query-too-long"], ["\ud83d", "query-invalid"], [Array.from({length: 13}, (_, i) => `w${i}`).join(" "), "query-too-many-terms"]] as const) {
      try { compileSearchQuery(value); throw new Error("Expected query rejection"); }
      catch (error) { expect(error).toBeInstanceOf(SearchQueryError); expect((error as SearchQueryError).code).toBe(code); }
    }
  });
});

describe("bounded literal matching and original scalar highlights", () => {
  const scan = async (raw: string, pieces: readonly (string | null)[]) => {
    const query = compileSearchQuery(raw)!;
    const matcher = new LiteralMatcher(query);
    let mask = 0;
    const snippets = [];
    for (const piece of pieces) {
      if (piece === null) { matcher.boundary(); continue; }
      for (const chunk of splitSearchText(piece)) {
        const result = await new SearchWork(matcher.push(chunk), undefined, async () => {}).round();
        if (result.status !== "done") throw new Error("One bounded chunk unexpectedly paused");
        mask |= result.value.mask;
        if (result.value.excerpt) snippets.push(result.value.excerpt);
      }
    }
    const final = await new SearchWork(matcher.finish(), undefined, async () => {}).round();
    if (final.status === "done") { mask |= final.value.mask; if (final.value.excerpt) snippets.push(final.value.excerpt); }
    return { mask, snippets };
  };
  it("maps expansion and astral hits to whole original scalar bounds", async () => {
    const sharp = await scan("ss", ["Straße"]);
    expect(sharp.snippets[0]).toEqual({ text: "Straße", matches: [{ from: 4, to: 5 }], before: false, after: false });
    const dotted = await scan("\u0307", ["xİ😀"]);
    expect(dotted.snippets[0]?.matches).toEqual([{ from: 1, to: 2 }]);
    const astral = await scan("\u{10428}", ["😀\u{10400}😀"]);
    expect(astral.snippets[0]?.matches).toEqual([{ from: 2, to: 4 }]);
  });
  it("matches across contiguous marked nodes and chunk splits but not semantic boundaries", async () => {
    expect((await scan("Straße", ["Stra", "ße"])).mask).toBe(1);
    expect((await scan("Straße", ["Stra", null, "ße"])).mask).toBe(0);
    expect((await scan("needle", ["x".repeat(4094) + "needle"])).mask).toBe(1);
    expect((await scan("😀x", ["a".repeat(4095) + "😀x"])).mask).toBe(1);
    expect((await scan("\u{10428}", ["\ud801", "\udc00"])).mask).toBe(1);
    expect((await scan("\u{10428}", ["\ud801", null, "\udc00"])).mask).toBe(0);
  });
  it("keeps literal HTML-looking source, all term evidence, and overlapping highlights", async () => {
    expect((await scan("<script> ss", ["<script> Straße"])).mask).toBe(3);
    const overlap = await scan("aa", ["aaa"]);
    expect(overlap.snippets[0]?.matches).toEqual([{ from: 0, to: 3 }]);
  });
  it("bounds retained snippets without truncating the match count or splitting emoji", async () => {
    const result = await scan("needle", ["😀".repeat(10000) + "needle" + "😀".repeat(10000)]);
    expect(result.mask).toBe(1);
    expect(result.snippets[0]!.text.length).toBeLessThanOrEqual(240);
    expect(result.snippets[0]!.before).toBe(true);
    expect(result.snippets[0]!.after).toBe(true);
    expect([...result.snippets[0]!.text].every(scalar => scalar.length === 2 ||
      scalar.charCodeAt(0) < 0xd800 || scalar.charCodeAt(0) > 0xdfff)).toBe(true);
  });
});
