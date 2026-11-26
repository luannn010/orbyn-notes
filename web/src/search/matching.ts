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
export type ChunkMatch = Readonly<{ mask: number; excerpt: SearchExcerpt | null; excerptFrom?: number }>;

/** Transport descriptors only: no source inspection or text allocation before the
 * consumer grants work. The matcher owns surrogate and normalization carry. */
export function* splitSearchText(source: string, start = 0, end = source.length): Generator<TextSlice, void, void> {
  for (let from = start; from < end; ) {
    const to = Math.min(from + 4091, end);
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

const marks = /\p{M}/u;
const hangulVowel = (point: number) => point >= 0x1161 && point <= 0x1175;
const hangulTrailing = (point: number) => point >= 0x11a8 && point <= 0x11c2;
/** A code point that can continue the current NFC cluster. Canonical
 * composition and ordering never cross a non-mark starter, except for Hangul
 * vowel and trailing jamo and Kirat Rai vowel signs AA and O. U+034F blocks
 * composition and reordering, so it is a safe boundary despite being a mark. */
function continuesCluster(point: number): boolean {
  return hangulVowel(point) || hangulTrailing(point) || point === 0x16d67 || point === 0x16d68 ||
    (point !== 0x034f && point >= 0x80 && marks.test(String.fromCodePoint(point)));
}
/** Start offsets of the clusters in text; the last cluster ends at text.length. */
function clusterStarts(text: string): number[] {
  const starts = [0];
  for (let offset = 0; offset < text.length; ) {
    const point = text.codePointAt(offset)!;
    const size = point > 0xffff ? 2 : 1;
    if (offset > 0 && !continuesCluster(point)) starts.push(offset);
    offset += size;
  }
  return starts;
}
type NormalizedCluster = Readonly<{
  text: string;
  from: readonly number[];
  to: readonly number[];
}>;
/** NFC of one cluster plus the original code-unit span of every normalized
 * UTF16 unit. Per-code-point normalization is exact when it equals the whole
 * cluster; when composition or reordering changed the result, each resulting
 * unit maps to the whole cluster. */
function normalizeCluster(original: string): NormalizedCluster {
  const text = original.normalize("NFC");
  const first = original.codePointAt(0)!;
  if (original.length === (first > 0xffff ? 2 : 1))
    return {
      text,
      from: new Array<number>(text.length).fill(0),
      to: new Array<number>(text.length).fill(original.length),
    };
  const parts: { from: number; to: number; text: string }[] = [];
  let joined = "";
  for (let offset = 0; offset < original.length; ) {
    const point = original.codePointAt(offset)!;
    const size = point > 0xffff ? 2 : 1;
    const part = original.slice(offset, offset + size).normalize("NFC");
    parts.push({ from: offset, to: offset + size, text: part });
    joined += part;
    offset += size;
  }
  const from: number[] = [], to: number[] = [];
  if (joined === text) {
    for (const part of parts)
      for (let unit = 0; unit < part.text.length; unit++) {
        from.push(part.from);
        to.push(part.to);
      }
  } else {
    for (let unit = 0; unit < text.length; unit++) {
      from.push(0);
      to.push(original.length);
    }
  }
  return { text, from, to };
}

/** KMP states span contiguous text nodes/chunks. A semantic atom that is not
 * searchable MUST finish() before boundary(): it cannot make its two neighbours match. */
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
  private pendingParts: TextSlice[] = [];
  private pendingUnits = 0;
  private queuedParts: TextSlice[] = [];
  private queuedUnits = 0;

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
    this.pendingParts = [];
    this.pendingUnits = 0;
    this.queuedParts = [];
    this.queuedUnits = 0;
  }

  *push(input: string | TextSlice): Generator<WorkEvent, ChunkMatch, void> {
    return yield* this.scan(input, false);
  }

  /** Finish one contiguous field. A final unmatched high unit remains literal;
   * the query compiler never admits a lone unit as a valid search term. */
  *finish(): Generator<WorkEvent, ChunkMatch, void> {
    if (!this.pendingHigh && !this.pendingUnits && !this.queuedUnits)
      return { mask: 0, excerpt: null };
    return yield* this.scan("", true);
  }

  private *scan(
    input: string | TextSlice,
    final: boolean,
  ): Generator<WorkEvent, ChunkMatch, void> {
    const part =
      typeof input === "string"
        ? { source: input, from: 0, to: input.length }
        : input;
    const units = part.to - part.from;
    if (
      !Number.isSafeInteger(part.from) ||
      !Number.isSafeInteger(part.to) ||
      part.from < 0 ||
      part.to > part.source.length ||
      units < 0 ||
      units > 4096
    )
      throw new Error("Search text requires a bounded valid chunk.");
    // Leave room for the two boundary inspections around a normalization step
    // before SearchWork's 4096-scalar task-yield threshold. Direct callers still
    // admit 4096 units through the same carry path.
    if (units > 4091) {
      const first = yield* this.scan(
        { source: part.source, from: part.from, to: part.from + 4091 },
        false,
      );
      const second = yield* this.scan(
        { source: part.source, from: part.from + 4091, to: part.to },
        final,
      );
      return {
        mask: first.mask | second.mask,
        excerpt: first.excerpt ?? second.excerpt,
        excerptFrom: first.excerpt ? first.excerptFrom : second.excerptFrom,
      };
    }
    // Inspect only the new chunk. Retain descriptors for an unfinished cluster:
    // repeated marked nodes must not repeatedly join/normalize the growing carry.
    const admittedUnits = units + this.pendingHigh.length;
    yield {
      type: "reserve",
      bytes: admittedUnits * 20 + (this.pendingParts.length + this.queuedParts.length) * 48 + 1024,
      visits: 1,
      scalars: admittedUnits,
    };
    // Normal chunks remain views into their admitted source. Only a surrogate
    // split between separate nodes needs a small joining copy here.
    const copiedUnits = this.pendingHigh ? admittedUnits : 0;
    const chunk = this.pendingHigh
      ? this.pendingHigh + part.source.slice(part.from, part.to)
      : part.source;
    const chunkFrom = this.pendingHigh ? 0 : part.from;
    let chunkTo = this.pendingHigh ? chunk.length : part.to;
    this.pendingHigh = "";
    if (!final && chunkTo > chunkFrom && high(chunk.charCodeAt(chunkTo - 1))) {
      this.pendingHigh = chunk.slice(chunkTo - 1, chunkTo);
      chunkTo--;
    }
    let first = -1, last = -1, inspected = 0, allocated = 0;
    for (let offset = chunkFrom; offset < chunkTo; ) {
      const point = chunk.codePointAt(offset)!;
      inspected++;
      if (!continuesCluster(point)) { first = offset; break; }
      offset += point > 0xffff ? 2 : 1;
    }
    if (first >= 0) {
      last = first;
      for (let offset = chunkTo; offset > first; ) {
        offset--;
        if (low(chunk.charCodeAt(offset)) && offset > first && high(chunk.charCodeAt(offset - 1))) offset--;
        if (offset === first) break; // Already inspected by the forward pass.
        inspected++;
        if (!continuesCluster(chunk.codePointAt(offset)!)) { last = offset; break; }
      }
    }
    const slice = (from: number, to: number): TextSlice => {
      allocated++;
      return { source: chunk, from, to };
    };
    const append = (parts: TextSlice[], from: number, to: number) => {
      const previous = parts.at(-1);
      // Transport chunks of one source can usually become one descriptor again.
      if (previous?.source === chunk && previous.to === from)
        parts[parts.length - 1] = slice(previous.from, to);
      else parts.push(slice(from, to));
    };
    const ready: TextSlice[][] = [];
    const leading = first < 0 ? chunkTo - chunkFrom : first - chunkFrom;
    const clusterUnits = this.pendingUnits + leading;
    const oversized = clusterUnits > 4096;
    if (!oversized) {
      if (first < 0) {
        if (chunkTo > chunkFrom) append(this.pendingParts, chunkFrom, chunkTo);
        this.pendingUnits = clusterUnits;
        if (final && this.pendingUnits) {
          ready.push(this.pendingParts);
          this.pendingParts = [];
          this.pendingUnits = 0;
        }
      } else {
        const leadingParts = this.pendingParts;
        if (leading) append(leadingParts, chunkFrom, first);
        const end = final ? chunkTo : last;
        const bodyUnits = end - first;
        if (clusterUnits && clusterUnits + bodyUnits <= 4096) {
          if (bodyUnits) append(leadingParts, first, end);
          ready.push(leadingParts);
        } else {
          if (clusterUnits) ready.push(leadingParts);
          if (bodyUnits) ready.push([slice(first, end)]);
        }
        this.pendingParts = final ? [] : [slice(last, chunkTo)];
        this.pendingUnits = final ? 0 : chunkTo - last;
      }
    }
    // Small marked nodes share a bounded transform batch instead of creating
    // normalization maps and KMP envelopes for every individual character.
    const batches: TextSlice[][] = [];
    let queuedReferences = 0;
    if (!oversized) {
      const flush = () => {
        if (this.queuedUnits) batches.push(this.queuedParts);
        this.queuedParts = [];
        this.queuedUnits = 0;
      };
      for (const parts of ready) {
        const size = parts.reduce((sum, item) => sum + item.to - item.from, 0);
        if (this.queuedUnits + size > 4096) flush();
        for (const item of parts) {
          const previous = this.queuedParts.at(-1);
          if (previous?.source === item.source && previous.to === item.from) {
            allocated++;
            this.queuedParts[this.queuedParts.length - 1] = {
              source: item.source, from: previous.from, to: item.to,
            };
          } else { this.queuedParts.push(item); queuedReferences++; }
        }
        this.queuedUnits += size;
        if (this.queuedUnits >= 1024) flush();
      }
      if (final) flush();
    }
    // Source copying is byte work; scalar settlement counts the boundary
    // points actually inspected here. The full normalize/fold pass is charged
    // separately by match(), so ordinary input is not charged twice.
    yield {
      type: "settle",
      bytes: copiedUnits * 2 + inspected * 8 + allocated * 48 + queuedReferences * 8 + 256,
      visits: 1,
      scalars: inspected,
    };
    if (oversized) {
      // SearchWork rejects this existing indivisible-work limit before any
      // overlarge carry is concatenated or normalized. Never force-flush it.
      yield {
        type: "reserve",
        bytes: clusterUnits * 36,
        visits: 1,
        scalars: clusterUnits,
      };
      throw new Error(
        "Search normalization requires an oversized indivisible reservation.",
      );
    }
    let mask = 0,
      excerpt: SearchExcerpt | null = null,
      excerptFrom: number | undefined;
    for (let index = 0; index < batches.length; index++) {
      const result = yield* this.match(
        batches[index]!,
        batches,
        index + 1,
        part.to < part.source.length,
      );
      mask |= result.mask;
      if (!excerpt && result.excerpt) {
        excerpt = result.excerpt;
        excerptFrom = result.excerptFrom;
      }
    }
    return { mask, excerpt, excerptFrom };
  }

  private *match(
    parts: readonly TextSlice[],
    batches: readonly (readonly TextSlice[])[],
    nextBatch: number,
    more: boolean,
  ): Generator<WorkEvent, ChunkMatch, void> {
    const admittedUnits = parts.reduce(
      (sum, part) => sum + part.to - part.from,
      0,
    );
    const maximumFolded = admittedUnits * MAX_CASE_FOLD_UTF16_UNITS;
    const combinedBound = maximumFolded + this.tailFolded.length;
    let descriptors = parts.length + this.queuedParts.length + this.pendingParts.length;
    for (let index = nextBatch; index < batches.length; index++)
      descriptors += batches[index]!.length;
    const descriptorBytes = descriptors * 96;
    const reserve =
      admittedUnits * 36 +
      combinedBound * (40 + 12 * this.terms.length) +
      descriptorBytes +
      100000;
    yield {
      type: "reserve",
      bytes: reserve,
      visits: 1,
      scalars: admittedUnits,
    };
    const only = parts.length === 1 ? parts[0]! : null;
    const text = only
      ? only.source.slice(only.from, only.to)
      : parts.map(part => part.source.slice(part.from, part.to)).join("");
    let folded = "", inputBytes = 0, foldedBytes = 0, scalars = 0;
    const from = this.tailFrom.slice(), to = this.tailTo.slice();
    const base = this.tailText.length;
    const normalized = text.length === 0 ? "" : text.normalize("NFC");
    if (normalized === text) {
      for (let offset = 0; offset < text.length; ) {
        const point = text.codePointAt(offset)!;
        const size = point > 0xffff ? 2 : 1;
        // ASCII is already NFC and folds one-to-one. Avoid Unicode table and
        // mapped-scalar iteration on the common path; non-ASCII uses the pinned map.
        const ascii = point < 0x80;
        const mapped = ascii
          ? point >= 0x41 && point <= 0x5a ? String.fromCharCode(point + 0x20) : text[offset]!
          : foldCodePoint(point);
        folded += mapped;
        inputBytes += ascii ? 1 : utf8(point);
        foldedBytes += ascii ? 1 : bytes(mapped);
        scalars++;
        for (let i = 0; i < mapped.length; i++) {
          from.push(base + offset);
          to.push(base + offset + size);
        }
        offset += size;
      }
    } else {
      const starts = clusterStarts(text);
      for (let index = 0; index < starts.length; index++) {
        const start = starts[index]!;
        const end = starts[index + 1] ?? text.length;
        const ascii = text.charCodeAt(start);
        if (end === start + 1 && ascii < 0x80) {
          // A changed NFC batch still contains many unchanged ASCII clusters.
          // Do not allocate normalization maps for each of those single units.
          folded += ascii >= 0x41 && ascii <= 0x5a
            ? String.fromCharCode(ascii + 0x20) : text[start]!;
          foldedBytes++;
          inputBytes++;
          scalars++;
          from.push(base + start);
          to.push(base + end);
          continue;
        }
        const cluster = normalizeCluster(text.slice(start, end));
        for (let offset = 0; offset < cluster.text.length; ) {
          const point = cluster.text.codePointAt(offset)!;
          const size = point > 0xffff ? 2 : 1;
          const mapped = foldCodePoint(point);
          folded += mapped;
          foldedBytes += bytes(mapped);
          for (let i = 0; i < mapped.length; i++) {
            from.push(base + start + cluster.from[offset]!);
            to.push(base + start + cluster.to[offset]!);
          }
          offset += size;
        }
        for (let offset = start; offset < end; ) {
          const point = text.codePointAt(offset)!;
          inputBytes += utf8(point);
          scalars++;
          offset += point > 0xffff ? 2 : 1;
        }
      }
    }
    const finalizedLength = this.tailText.length + text.length;
    let combined = "", remainingUnits = 0;
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
            // Context is not provisional KMP input. Build it once, only for a hit.
            let suffix = "";
            const appendContext = (part: TextSlice) => {
              remainingUnits += part.to - part.from;
              if (suffix.length < 240)
                suffix += part.source.slice(part.from, Math.min(part.to, part.from + 240 - suffix.length));
            };
            for (let index = nextBatch; index < batches.length; index++)
              for (const part of batches[index]!) appendContext(part);
            for (const part of this.queuedParts) appendContext(part);
            for (const part of this.pendingParts) appendContext(part);
            if (this.pendingHigh) {
              remainingUnits++;
              if (suffix.length < 240) suffix += this.pendingHigh;
            }
            if (suffix.length && high(suffix.charCodeAt(suffix.length - 1))) suffix = suffix.slice(0, -1);
            combined = this.tailText + text + suffix;
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
    const excerptFrom = begin < 0 ? undefined : this.consumed - this.tailText.length + begin;
    const excerpt = begin < 0 ? null : Object.freeze({
      text: combined.slice(begin, end), matches: Object.freeze(merged),
      before: this.consumed - this.tailText.length + begin > 0,
      after: end < finalizedLength + remainingUnits || more,
    });
    const combinedFolded = this.tailFolded + folded;
    const keepFrom = Math.max(0, combinedFolded.length - this.carryUnits);
    const keepOriginalFrom = from[keepFrom] ?? finalizedLength;
    this.tailFolded = combinedFolded.slice(keepFrom);
    this.tailText = keepOriginalFrom >= base
      ? text.slice(keepOriginalFrom - base)
      : this.tailText.slice(keepOriginalFrom) + text;
    this.tailFrom = from.slice(keepFrom).map(value => value - keepOriginalFrom);
    this.tailTo = to.slice(keepFrom).map(value => value - keepOriginalFrom);
    this.consumed += text.length;
    const actual = inputBytes * 2 + foldedBytes + from.length * 8 + comparisons * 2 +
      combined.length * 2 + text.length * 2 + this.tailText.length * 2 + ranges.length * 32 + descriptorBytes + 2048;
    yield { type: "settle", bytes: actual, visits: 1, scalars };
    return Object.freeze({ mask, excerpt, excerptFrom });
  }
}
