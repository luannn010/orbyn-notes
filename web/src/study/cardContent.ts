import type { CardKey } from "../collections/contracts";
import { SearchIdentityMap } from "../search/identity";
import type { WorkEvent } from "../search/work";
export type CardContentInput =
  | Readonly<{
      type: "basic";
      key: "basic:forward";
      front: string;
      back: string;
    }>
  | Readonly<{
      type: "reversed";
      key: "reversed:forward" | "reversed:reverse";
      front: string;
      back: string;
    }>
  | Readonly<{
      type: "cloze";
      key: Extract<CardKey, `cloze:${string}`>;
      text: string;
      blanks: readonly Readonly<{ id: string; answer: string }>[];
    }>;
export type CardContentSide = "front" | "back";
declare const readerBrand: unique symbol;
declare const cursorBrand: unique symbol;
export type CardContentReader = Readonly<{ [readerBrand]: true }>;
export type CardContentCursor = Readonly<{ [cursorBrand]: true }>;
export type CardContentPage = Readonly<{
  text: string;
  start: number;
  end: number;
  total: number;
  previous: CardContentCursor | null;
  next: CardContentCursor | null;
}>;
type Segment = { text: string; from: number; to: number; end: number };
type Field = { segments: Segment[]; total: number };
type State = {
  front: Field;
  back: Field;
  disposed: boolean;
  pages: Set<Generator<WorkEvent, CardContentPage, void>>;
};
type Position = {
  reader: CardContentReader;
  side: CardContentSide;
  start: number;
  previous: CardContentCursor | null;
};
const readers = new WeakMap<CardContentReader, State>(),
  cursors = new WeakMap<CardContentCursor, Position>();
const empty = (): Field => ({ segments: [], total: 0 });
function invalid(): never {
  throw new Error("Invalid card content.");
}
function stateOf(reader: CardContentReader): State {
  const state = readers.get(reader);
  if (!state || state.disposed)
    throw new Error("Card content was released or is invalid.");
  return state;
}
function* work<T>(
  bytes: number,
  visits: number,
  operation: () => T,
  scalars = 0,
): Generator<WorkEvent, T, void> {
  yield { type: "reserve", bytes, visits, scalars };
  const result = operation();
  yield { type: "settle", bytes, visits, scalars };
  return result;
}
function release(state: State) {
  state.disposed = true;
  for (const page of state.pages) page.return(undefined!);
  state.pages.clear();
  state.front.segments.length = 0;
  state.back.segments.length = 0;
  state.front.total = 0;
  state.back.total = 0;
}
export function disposeCardContent(reader: CardContentReader): void {
  const state = readers.get(reader);
  if (!state) invalid();
  release(state);
}
function checkedText(value: unknown): string {
  if (typeof value !== "string" || value.length > 100000) invalid();
  return value;
}
function capture(input: CardContentInput): CardContentInput {
  if (!input || typeof input !== "object") invalid();
  if (input.type === "basic" || input.type === "reversed") {
    if (
      input.type === "basic"
        ? input.key !== "basic:forward"
        : input.key !== "reversed:forward" && input.key !== "reversed:reverse"
    )
      invalid();
    return Object.freeze({
      type: input.type,
      key: input.key,
      front: checkedText(input.front),
      back: checkedText(input.back),
    }) as CardContentInput;
  }
  if (
    input.type !== "cloze" ||
    typeof input.key !== "string" ||
    input.key.length > 106 ||
    !input.key.startsWith("cloze:") ||
    !Array.isArray(input.blanks) ||
    input.blanks.length < 1 ||
    input.blanks.length > 100
  )
    invalid();
  const blanks = input.blanks.map((blank) => {
    if (
      !blank ||
      typeof blank !== "object" ||
      typeof blank.id !== "string" ||
      blank.id.length < 1 ||
      blank.id.length > 100
    )
      invalid();
    return Object.freeze({ id: blank.id, answer: checkedText(blank.answer) });
  });
  return Object.freeze({
    type: "cloze",
    key: input.key,
    text: checkedText(input.text),
    blanks: Object.freeze(blanks),
  });
}
function* nonempty(text: string): Generator<WorkEvent, void, void> {
  for (let from = 0; from < text.length;) {
    const to = Math.min(text.length, from + 4096),
      found = yield* work(
        (to - from) * 6 + 64,
        1,
        () => text.slice(from, to).trim().length > 0,
        to - from,
      );
    if (found) return;
    from = to;
  }
  invalid();
}
function* append(
  field: Field,
  text: string,
  from = 0,
  to = text.length,
): Generator<WorkEvent, void, void> {
  if (from === to) return;
  yield* work(64, 1, () => {
    field.total += to - from;
    if (!Number.isSafeInteger(field.total)) invalid();
    field.segments.push({ text, from, to, end: field.total });
  });
}
function* parse(
  input: Extract<CardContentInput, { type: "cloze" }>,
  state: State,
): Generator<WorkEvent, void, void> {
  const blanks = new SearchIdentityMap<{ answer: string; seen: number }>(),
    literals: { from: number; to: number }[] = [];
  try {
    for (const blank of input.blanks) {
      yield* work(
        blank.id.length * 6 + 64,
        1,
        () => {
          if (!/^[A-Za-z0-9_-]{1,100}$/.test(blank.id)) invalid();
        },
        blank.id.length,
      );
      yield* nonempty(blank.answer);
      if (yield* blanks.get(blank.id)) invalid();
      yield* blanks.set(blank.id, { answer: blank.answer, seen: 0 });
    }
    const selected = input.key.slice(6);
    if (!(yield* blanks.get(selected))) invalid();
    let literal = 0,
      open = -1,
      stage = 0,
      length = 0;
    for (let from = 0; from < input.text.length;) {
      const to = Math.min(input.text.length, from + 4096),
        found: { from: number; to: number; id: string }[] = [];
      yield* work(
        (to - from) * 40 + 128,
        1,
        () => {
          for (let p = from; p < to; p++) {
            const unit = input.text[p]!;
            if (stage === 0) {
              if (unit === "{") {
                open = p;
                stage = 1;
              }
            } else if (stage === 1) {
              if (unit === "{") {
                stage = 2;
                length = 0;
              } else {
                stage = 0;
                open = -1;
              }
            } else if (stage === 2) {
              if (unit === "}") stage = 3;
              else if (unit === "{") {
                open = length === 0 ? p - 1 : p;
                stage = length === 0 ? 2 : 1;
                length = 0;
              } else if (length < 101) length++;
              else {
                stage = 0;
                open = -1;
              }
            } else if (unit === "}" && length) {
              found.push({
                from: open,
                to: p + 1,
                id: input.text.slice(open + 2, p - 1),
              });
              stage = 0;
              open = -1;
            } else if (unit === "{") {
              open = p;
              stage = 1;
              length = 0;
            } else {
              stage = 0;
              open = -1;
            }
          }
        },
        to - from,
      );
      for (const marker of found) {
        const blank = yield* blanks.get(marker.id);
        if (!blank || blank.seen++) invalid();
        yield* work(32, 1, () =>
          literals.push({ from: literal, to: marker.from }),
        );
        yield* append(state.front, input.text, literal, marker.from);
        yield* append(state.back, input.text, literal, marker.from);
        yield* append(
          state.front,
          marker.id === selected ? "[...]" : blank.answer,
        );
        yield* append(state.back, blank.answer);
        literal = marker.to;
      }
      from = to;
    }
    yield* work(32, 1, () =>
      literals.push({ from: literal, to: input.text.length }),
    );
    yield* append(state.front, input.text, literal);
    yield* append(state.back, input.text, literal);
    // Match producer admission after removing complete markers, without joining
    // the literal residue or scanning answers as if they were marker syntax.
    let previous = "";
    for (const span of literals)
      for (let from = span.from; from < span.to;) {
        const to = Math.min(span.to, from + 4096);
        yield* work(
          (to - from) * 6 + 32,
          1,
          () => {
            for (let p = from; p < to; p++) {
              const unit = input.text[p]!;
              if (
                (unit === "{" && previous === "{") ||
                (unit === "}" && previous === "}")
              )
                invalid();
              previous = unit;
            }
          },
          to - from,
        );
        from = to;
      }
    for (const blank of input.blanks)
      if ((yield* blanks.get(blank.id))!.seen !== 1) invalid();
  } finally {
    blanks.clear();
    literals.length = 0;
  }
}
export function* buildCardContent(
  input: CardContentInput,
): Generator<WorkEvent, CardContentReader, void> {
  const state: State = {
    front: empty(),
    back: empty(),
    disposed: false,
    pages: new Set(),
  };
  let completed = false;
  try {
    // One bounded structural copy occurs before the first possible suspension
    // after admission; no actual StudyEntry/input object is kept in reader state.
    const stable = yield* work(16384, 102, () => {
      const captured = capture(input);
      input = undefined!;
      return captured;
    });
    if (stable.type === "cloze") {
      yield* nonempty(stable.text);
      yield* parse(stable, state);
    } else {
      yield* nonempty(stable.front);
      yield* nonempty(stable.back);
      yield* append(
        state.front,
        stable.key === "reversed:reverse" ? stable.back : stable.front,
      );
      yield* append(
        state.back,
        stable.key === "reversed:reverse" ? stable.front : stable.back,
      );
    }
    const reader = Object.freeze({}) as CardContentReader;
    readers.set(reader, state);
    completed = true;
    return reader;
  } finally {
    input = undefined!;
    if (!completed) release(state);
  }
}
function position(
  reader: CardContentReader,
  side: CardContentSide,
  start: number,
  previous: CardContentCursor | null,
): CardContentCursor {
  const value = Object.freeze({}) as CardContentCursor;
  cursors.set(value, { reader, side, start, previous });
  return value;
}
function* locate(
  field: Field,
  offset: number,
): Generator<WorkEvent, number, void> {
  let low = 0,
    high = field.segments.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2),
      end = yield* work(32, 1, () => field.segments[middle]!.end);
    if (offset < end) high = middle;
    else low = middle + 1;
  }
  return low;
}
function* unitAt(
  field: Field,
  offset: number,
): Generator<WorkEvent, number, void> {
  const i = yield* locate(field, offset),
    segment = field.segments[i];
  if (!segment) return NaN;
  return yield* work(
    8,
    1,
    () =>
      segment.text.charCodeAt(
        segment.from + offset - (segment.end - (segment.to - segment.from)),
      ),
    1,
  );
}
function* page(
  reader: CardContentReader,
  side: CardContentSide,
  cursor?: CardContentCursor,
): Generator<WorkEvent, CardContentPage, void> {
  const state = stateOf(reader);
  if (side !== "front" && side !== "back") invalid();
  const field = state[side];
  let current: CardContentCursor;
  if (cursor !== undefined) {
    const at = cursors.get(cursor);
    if (!at || at.reader !== reader || at.side !== side) invalid();
    current = cursor;
  } else current = yield* work(64, 1, () => position(reader, side, 0, null));
  const at = cursors.get(current)!,
    start = at.start;
  let end = Math.min(field.total, start + 16384);
  if (end < field.total) {
    const before = yield* unitAt(field, end - 1),
      after = yield* unitAt(field, end);
    if (
      before >= 0xd800 &&
      before <= 0xdbff &&
      after >= 0xdc00 &&
      after <= 0xdfff
    )
      end--;
  }
  const chunks: string[] = [];
  let index = yield* locate(field, start),
    offset = start;
  while (offset < end) {
    stateOf(reader);
    const segment = field.segments[index]!;
    const begin =
        segment.from + offset - (segment.end - (segment.to - segment.from)),
      to = Math.min(segment.to, begin + 4096, begin + end - offset);
    yield* work(
      (to - begin) * 7 + 64,
      1,
      () => chunks.push(segment.text.slice(begin, to)),
      to - begin,
    );
    offset += to - begin;
    if (offset === segment.end) index++;
  }
  stateOf(reader);
  const text = yield* work((end - start) * 2 + 128, chunks.length + 1, () =>
    chunks.join(""),
  );
  stateOf(reader);
  const next =
    end < field.total
      ? yield* work(64, 1, () => position(reader, side, end, current))
      : null;
  return Object.freeze({
    text,
    start,
    end,
    total: field.total,
    previous: at.previous,
    next,
  });
}
export function readCardContentPage(
  reader: CardContentReader,
  side: CardContentSide,
  cursor?: CardContentCursor,
): Generator<WorkEvent, CardContentPage, void> {
  const state = stateOf(reader);
  let iterator!: Generator<WorkEvent, CardContentPage, void>;
  iterator = (function* () {
    try {
      return yield* page(reader, side, cursor);
    } finally {
      state.pages.delete(iterator);
    }
  })();
  state.pages.add(iterator);
  return iterator;
}
