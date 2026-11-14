import { foldCodePoint, MAX_CASE_FOLD_UTF16_UNITS } from "./unicodeCaseFolding";
import type { SearchQuery } from "./text";
import type { WorkEvent } from "./work";

export type SearchRange = Readonly<{ from: number; to: number }>;
export type SearchExcerpt = Readonly<{
  text: string;
  matches: readonly SearchRange[];
  before: boolean;
  after: boolean;
}>;
export type TextSlice = Readonly<{ source: string; from: number; to: number }>;
export type ChunkMatch = Readonly<{ mask: number; excerpt: SearchExcerpt | null }>;

/** Descriptors only: the consumer reserves work before slicing/allocating. */
export function* splitSearchText(source: string): Generator<TextSlice, void, void> {
  for (let from = 0; from < source.length; ) {
    let to = Math.min(from + 4095, source.length);
    if (to < source.length && high(source.charCodeAt(to - 1)) && low(source.charCodeAt(to))) to--;
    yield { source, from, to };
    from = to;
  }
}
const high = (unit: number) => unit >= 0xd800 && unit <= 0xdbff;
const low = (unit: number) => unit >= 0xdc00 && unit <= 0xdfff;
const utf8 = (point: number) => point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
function bytes(text: string): number {
  let result = 0;
  for (const scalar of text) result += utf8(scalar.codePointAt(0)!);
  return result;
}
function prefix(term: string): readonly number[] {
  const table = new Array<number>(term.length).fill(0);
  for (let i = 1, size = 0; i < term.length; i++) {
    while (size > 0 && term[i] !== term[size]) size = table[size - 1]!;
    if (term[i] === term[size]) size++;
    table[i] = size;
  }
  return table;
}

/** KMP states span contiguous text nodes/chunks. A semantic atom that is not
 * searchable MUST call boundary(): it cannot make its two neighbours match. */
export class LiteralMatcher {
  private readonly terms: readonly string[];
  private readonly prefixes: readonly (readonly number[])[];
  private readonly carryUnits: number;
  private states: number[];
  private tailFolded = "";
  private tailText = "";
  private tailFrom: number[] = [];
  private tailTo: number[] = [];
  private consumed = 0;
  private pendingHigh = "";

  constructor(query: SearchQuery) {
    this.terms = query.terms;
    this.prefixes = this.terms.map(prefix);
    this.states = this.terms.map(() => 0);
    this.carryUnits = Math.max(...this.terms.map(term => term.length)) - 1;
  }

  boundary(): void {
    this.states.fill(0);
    this.tailFolded = "";
    this.tailText = "";
    this.tailFrom = [];
    this.tailTo = [];
    this.consumed = 0;
    this.pendingHigh = "";
  }

  *push(input: string | TextSlice): Generator<WorkEvent, ChunkMatch, void> {
    return yield* this.scan(input, false);
  }

  /** Finish one contiguous field. A final unmatched high unit remains literal;
   * the query compiler never admits a lone unit as a valid search term. */
  *finish(): Generator<WorkEvent, ChunkMatch, void> {
    if (!this.pendingHigh) return { mask: 0, excerpt: null };
    return yield* this.scan("", true);
  }

  private *scan(input: string | TextSlice, final: boolean): Generator<WorkEvent, ChunkMatch, void> {
    const part = typeof input === "string" ? { source: input, from: 0, to: input.length } : input;
    const units = part.to - part.from;
    if (!Number.isSafeInteger(part.from) || !Number.isSafeInteger(part.to) || part.from < 0 ||
        part.to > part.source.length || units < 0 || units > 4096)
      throw new Error("Search text requires a bounded valid chunk.");
    // Leave room for the high unit buffered from a preceding marked node.
    // Recursion is at most one level for a caller's single 4096-unit chunk.
    if (units === 4096) {
      const first = yield* this.scan({ source: part.source, from: part.from, to: part.from + 4095 }, false);
      const second = yield* this.scan({ source: part.source, from: part.from + 4095, to: part.to }, final);
      return { mask: first.mask | second.mask, excerpt: first.excerpt ?? second.excerpt };
    }
    const admittedUnits = units + this.pendingHigh.length;
    const maximumFolded = admittedUnits * MAX_CASE_FOLD_UTF16_UNITS;
    const combinedBound = maximumFolded + this.tailFolded.length;
    // Includes slicing, scalar folding, map construction, each linear KMP pass,
    // bounded excerpt/range sorting and carry compaction. Actual settlement
    // refunds the conservative Unicode/occurrence upper bound.
    const reserve = admittedUnits * 12 + combinedBound * (40 + 12 * this.terms.length) + 100000;
    yield { type: "reserve", bytes: reserve, visits: 1, scalars: admittedUnits };
    let text = this.pendingHigh + part.source.slice(part.from, part.to);
    this.pendingHigh = "";
    if (!final && high(text.charCodeAt(text.length - 1))) {
      this.pendingHigh = text.slice(-1);
      text = text.slice(0, -1);
    }
    let folded = "", inputBytes = 0, foldedBytes = 0, scalars = 0;
    const from = this.tailFrom.slice(), to = this.tailTo.slice();
    for (let offset = 0; offset < text.length; ) {
      const point = text.codePointAt(offset)!;
      const size = point > 0xffff ? 2 : 1;
      const mapped = foldCodePoint(point);
      folded += mapped;
      inputBytes += utf8(point);
      foldedBytes += bytes(mapped);
      scalars++;
      for (let i = 0; i < mapped.length; i++) {
        from.push(this.tailText.length + offset);
        to.push(this.tailText.length + offset + size);
      }
      offset += size;
    }
    const combined = this.tailText + text;
    const foldedOffset = this.tailFolded.length;
    let mask = 0, begin = -1, end = -1, comparisons = 0;
    const ranges: SearchRange[] = [];
    for (let i = 0; i < folded.length; i++) {
      for (let termIndex = 0; termIndex < this.terms.length; termIndex++) {
        const term = this.terms[termIndex]!;
        const table = this.prefixes[termIndex]!;
        let size = this.states[termIndex]!;
        while (size > 0 && folded[i] !== term[size]) { comparisons++; size = table[size - 1]!; }
        comparisons++;
        if (folded[i] === term[size]) size++;
        if (size === term.length) {
          mask |= 1 << termIndex;
          const hitFrom = from[foldedOffset + i - term.length + 1]!;
          const hitTo = to[foldedOffset + i]!;
          if (begin < 0) {
            begin = Math.max(0, hitFrom - 80);
            if (low(combined.charCodeAt(begin)) && high(combined.charCodeAt(begin - 1))) begin--;
            end = Math.min(combined.length, begin + 240);
            if (high(combined.charCodeAt(end - 1)) && low(combined.charCodeAt(end))) end--;
          }
          if (hitFrom < end && hitTo > begin)
            ranges.push({ from: Math.max(begin, hitFrom) - begin, to: Math.min(end, hitTo) - begin });
          size = table[size - 1]!;
        }
        this.states[termIndex] = size;
      }
    }
    ranges.sort((a, b) => a.from - b.from || a.to - b.to);
    const merged: SearchRange[] = [];
    for (const range of ranges) {
      const previous = merged.at(-1);
      if (previous && range.from <= previous.to)
        merged[merged.length - 1] = Object.freeze({ from: previous.from, to: Math.max(previous.to, range.to) });
      else merged.push(Object.freeze(range));
    }
    const excerpt = begin < 0 ? null : Object.freeze({
      text: combined.slice(begin, end), matches: Object.freeze(merged),
      before: this.consumed - this.tailText.length + begin > 0,
      after: end < combined.length || part.to < part.source.length || this.pendingHigh.length > 0,
    });
    const combinedFolded = this.tailFolded + folded;
    const keepFrom = Math.max(0, combinedFolded.length - this.carryUnits);
    const keepOriginalFrom = from[keepFrom] ?? combined.length;
    this.tailFolded = combinedFolded.slice(keepFrom);
    this.tailText = combined.slice(keepOriginalFrom);
    this.tailFrom = from.slice(keepFrom).map(value => value - keepOriginalFrom);
    this.tailTo = to.slice(keepFrom).map(value => value - keepOriginalFrom);
    this.consumed += text.length;
    const actual = inputBytes * 2 + foldedBytes + from.length * 8 + comparisons * 2 +
      combined.length * 2 + this.tailText.length * 2 + ranges.length * 32 + 512;
    yield { type: "settle", bytes: actual, visits: 1, scalars };
    return Object.freeze({ mask, excerpt });
  }
}
