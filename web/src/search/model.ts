import type {
  SearchSourceReader,
  SearchNoteView,
  SearchEntryView,
  SearchDeckView,
  SearchCardView,
  SearchNodeCursor,
} from "./contracts";
import type { SearchQuery } from "./text";
import { LiteralMatcher, splitSearchText } from "./matching";
import type { SearchExcerpt, TextSlice } from "./matching";
import type {
  SearchCounts,
  SearchKind,
  SearchHit,
  SearchProgress,
} from "./results";
import type { WorkEvent, WorkCost } from "./work";
import { SearchIdentityMap } from "./identity";

declare const indexBrand: unique symbol;
export type SearchIndex = Readonly<{ [indexBrand]: true }>;
type Segment = TextSlice | null | { placeholder: true };
type ClozeSegment = TextSlice | { blankId: string; answer: string };
type Entry = {
  ordinal: number;
  view: SearchEntryView;
  segments: ClozeSegment[] | null;
};
type Row = {
  ordinal: number;
  primary: boolean;
  title: string;
  updatedAt: string;
  entryOrdinal: number;
  card: SearchCardView | null;
};
type State = {
  reader: SearchSourceReader | null;
  query: SearchQuery | null;
  notes: SearchIdentityMap<SearchNoteView>;
  entries: SearchIdentityMap<Entry>;
  decks: SearchIdentityMap<SearchDeckView>;
  noteRows: Row[];
  clipRows: Row[];
  cardRows: Row[];
  disposed: boolean;
  pages: Set<Generator<WorkEvent, readonly SearchHit[], void>>;
};
const states = new WeakMap<SearchIndex, State>();
function stateOf(
  index: SearchIndex,
): State & { reader: SearchSourceReader; query: SearchQuery } {
  const state = states.get(index);
  if (!state || state.disposed || !state.reader || !state.query)
    throw new Error("Search index was released or is invalid.");
  return state as State & { reader: SearchSourceReader; query: SearchQuery };
}
function* work<T>(
  bytes: number,
  visits: number,
  operation: () => T,
  scalars = 0,
): Generator<WorkEvent, T, void> {
  const cost: WorkCost = { bytes, visits, scalars };
  yield { type: "reserve", ...cost };
  const result = operation();
  yield { type: "settle", ...cost };
  return result;
}
function* read<T>(operation: () => T): Generator<WorkEvent, T, void> {
  return yield* work(2048, 1, operation);
}
function clear(state: State) {
  state.disposed = true;
  for (const page of state.pages) page.return(Object.freeze([]));
  state.pages.clear();
  state.reader = null;
  state.query = null;
  state.notes.clear();
  state.entries.clear();
  state.decks.clear();
  state.noteRows.length = 0;
  state.clipRows.length = 0;
  state.cardRows.length = 0;
}
export function disposeSearchIndex(index: SearchIndex): void {
  const state = states.get(index);
  if (!state) throw new Error("Invalid search index.");
  clear(state);
}
type Stream = Generator<WorkEvent, void, void>;
type Emit = (segment: Segment) => Stream;
function* plain(source: string, emit: Emit): Stream {
  for (const part of splitSearchText(source)) yield* emit(part);
}
function* document(state: State, root: SearchNodeCursor, emit: Emit): Stream {
  const reader = state.reader!;
  const stack: { cursor: SearchNodeCursor; exit: boolean; block: boolean }[] =
    [];
  yield* work(48, 1, () =>
    stack.push({ cursor: root, exit: false, block: false }),
  );
  while (stack.length) {
    const next = yield* work(48, 1, () => stack.pop()!);
    if (next.exit) {
      if (next.block) yield* emit({ source: "\n", from: 0, to: 1 });
      continue;
    }
    const node = yield* read(() => reader.node(next.cursor));
    if (node.type === "text") {
      if (node.text) yield* plain(node.text, emit);
      continue;
    }
    if (node.type === "noteLink") {
      const target = node.target,
        versions = reader.versions;
      if (
        target &&
        target.accountId === versions.accountId &&
        target.libraryEpoch === versions.library.epoch
      ) {
        const note = yield* state.notes.get(target.noteId);
        if (note && note.title.length > 0) yield* plain(note.title, emit);
        else yield* emit(null);
      } else yield* emit(null);
      continue;
    }
    if (node.type === "hardBreak" || node.type === "horizontalRule") {
      yield* emit({ source: "\n", from: 0, to: 1 });
      continue;
    }
    const block =
      node.type === "paragraph" ||
      node.type === "heading" ||
      node.type === "codeBlock" ||
      node.type === "blockquote" ||
      node.type === "listItem" ||
      node.type === "taskItem";
    if (block) yield* emit({ source: "\n", from: 0, to: 1 });
    yield* work(48, 1, () =>
      stack.push({ cursor: next.cursor, exit: true, block }),
    );
    for (let i = node.children - 1; i >= 0; i--) {
      const child = yield* read(() => reader.child(next.cursor, i));
      yield* work(48, 1, () =>
        stack.push({ cursor: child, exit: false, block: false }),
      );
    }
  }
}
function* parseCloze(
  reader: SearchSourceReader,
  view: Extract<SearchEntryView, { type: "cloze" }>,
): Generator<WorkEvent, ClozeSegment[], void> {
  const blanks = new SearchIdentityMap<string>(),
    result: ClozeSegment[] = [];
  try {
    for (let i = 0; i < view.blankCount; i++) {
      const blank = yield* read(() => reader.blank(view.cursor, i));
      yield* blanks.set(blank.id, blank.answer);
    }
    let start = 0,
      open = -1,
      idLength = 0,
      stage = 0;
    for (let from = 0; from < view.text.length;) {
      const to = Math.min(view.text.length, from + 4096),
        candidates: { from: number; to: number; id: string }[] = [];
      yield* work(
        (to - from) * 40 + 128,
        1,
        () => {
          for (let p = from; p < to; p++) {
            const unit = view.text[p]!;
            if (stage === 0) {
              if (unit === "{") {
                open = p;
                stage = 1;
              }
            } else if (stage === 1) {
              if (unit === "{") {
                stage = 2;
                idLength = 0;
              } else {
                stage = 0;
                open = -1;
              }
            } else if (stage === 2) {
              if (unit === "}") {
                stage = 3;
              } else if (unit === "{") {
                open = idLength === 0 ? p - 1 : p;
                stage = idLength === 0 ? 2 : 1;
                idLength = 0;
              } else {
                if (idLength < 101) idLength++;
                else {
                  stage = 0;
                  open = -1;
                }
              }
            } else {
              if (unit === "}" && idLength) {
                candidates.push({
                  from: open,
                  to: p + 1,
                  id: view.text.slice(open + 2, p - 1),
                });
                stage = 0;
                open = -1;
              } else if (unit === "{") {
                open = p;
                stage = 1;
                idLength = 0;
              } else {
                stage = 0;
                open = -1;
              }
            }
          }
        },
        to - from,
      );
      for (const candidate of candidates) {
        const answer = yield* blanks.get(candidate.id);
        if (answer === undefined)
          throw new Error("Invalid admitted Cloze marker.");
        yield* work(96, 1, () => {
          if (candidate.from > start)
            result.push({ source: view.text, from: start, to: candidate.from });
          result.push({ blankId: candidate.id, answer });
          start = candidate.to;
        });
      }
      from = to;
    }
    if (start < view.text.length)
      yield* work(32, 1, () =>
        result.push({ source: view.text, from: start, to: view.text.length }),
      );
    return result;
  } finally {
    blanks.clear();
  }
}
function* cardField(
  entry: Entry,
  key: string,
  front: boolean,
  emit: Emit,
): Stream {
  const view = entry.view;
  if (view.type !== "cloze") {
    const source =
      (key === "reversed:reverse") === front ? view.back : view.front;
    yield* plain(source, emit);
    return;
  }
  const selected = key.slice(6);
  for (const segment of entry.segments!) {
    yield* work(32, 1, () => undefined);
    if ("blankId" in segment) {
      if (front && segment.blankId === selected)
        yield* emit({ placeholder: true });
      else yield* plain(segment.answer, emit);
    }
    if ("source" in segment) {
      for (let from = segment.from; from < segment.to;) {
        const to = Math.min(segment.to, from + 4095);
        yield* emit({ source: segment.source, from, to });
        from = to;
      }
    }
  }
}
type Scan = {
  mask: number;
  excerpt: SearchExcerpt | null;
  preview: SearchExcerpt;
};
function* scan(
  query: SearchQuery,
  stream: (emit: Emit) => Stream,
): Generator<WorkEvent, Scan, void> {
  const queryUnits = query.terms.reduce((sum, term) => sum + term.length, 0);
  const matcher = yield* work(
    queryUnits * 16 + 256,
    1,
    () => new LiteralMatcher(query),
    queryUnits,
  );
  let mask = 0,
    excerpt: SearchExcerpt | null = null,
    prefix = "",
    more = false;
  const contexts: { excerpt: SearchExcerpt; runFrom: number }[] = [];
  let runFrom = 0;
  const emit: Emit = function* (segment) {
    if (segment === null || "placeholder" in segment) {
      const ended = yield* matcher.finish();
      mask |= ended.mask;
      excerpt ??= ended.excerpt;
      yield* work(128, 1, () => matcher.boundary());
      if (segment) {
        yield* work(16, 1, () => {
          const add = "[...]";
          const remaining = 240 - prefix.length;
          if (remaining > 0) prefix += add.slice(0, remaining);
          if (add.length > remaining) more = true;
        });
      }
      if (excerpt) excerpt = Object.freeze({ ...excerpt, after: true });
      runFrom = prefix.length;
      return;
    }
    const found = yield* matcher.push(segment);
    mask |= found.mask;
    if (excerpt) excerpt = Object.freeze({ ...excerpt, after: true });
    else excerpt = found.excerpt;
    if (found.excerpt && prefix.length < 240)
      contexts.push({ excerpt: found.excerpt, runFrom });
    yield* work(1024, 1, () => {
      let take = Math.min(segment.to - segment.from, 240 - prefix.length);
      if (take > 0) {
        const last = segment.source.charCodeAt(segment.from + take - 1),
          next = segment.source.charCodeAt(segment.from + take);
        if (
          last >= 0xd800 &&
          last <= 0xdbff &&
          next >= 0xdc00 &&
          next <= 0xdfff
        )
          take--;
        prefix += segment.source.slice(segment.from, segment.from + take);
      }
      if (segment.to - segment.from > take) more = true;
    });
  };
  yield* stream(emit);
  const ended = yield* matcher.finish();
  mask |= ended.mask;
  excerpt ??= ended.excerpt;
  if (excerpt && !more) {
    const marked = yield* work(256, 1, () =>
      new Array<boolean>(prefix.length).fill(false),
    );
    for (const context of contexts) {
      const at = yield* findText(prefix, context.excerpt.text, context.runFrom);
      if (at >= 0)
        yield* work(
          2048,
          1,
          () => {
            for (const range of context.excerpt.matches)
              for (
                let i = at + range.from;
                i < Math.min(prefix.length, at + range.to);
                i++
              )
                marked[i] = true;
          },
          prefix.length,
        );
    }
    excerpt = yield* work(
      4096,
      1,
      () => {
        const ranges: { from: number; to: number }[] = [];
        for (let i = 0; i < marked.length;) {
          if (!marked[i]) {
            i++;
            continue;
          }
          const from = i;
          while (marked[i]) i++;
          ranges.push(Object.freeze({ from, to: i }));
        }
        return Object.freeze({
          text: prefix,
          matches: Object.freeze(ranges),
          before: false,
          after: false,
        });
      },
      prefix.length,
    );
  }

  if (more && prefix.length) {
    const last = prefix.charCodeAt(prefix.length - 1);
    if (last >= 0xd800 && last <= 0xdbff)
      prefix = yield* work(512, 1, () => prefix.slice(0, -1));
  }
  return {
    mask,
    excerpt,
    preview: Object.freeze({
      text: prefix,
      matches: Object.freeze([]),
      before: false,
      after: more,
    }),
  };
}
function* findText(
  source: string,
  text: string,
  from = 0,
): Generator<WorkEvent, number, void> {
  if (!text.length) return from;
  let candidate = from,
    offset = 0,
    found = -1;
  while (candidate <= source.length - text.length && found < 0) {
    yield { type: "reserve", bytes: 12288, visits: 1, scalars: 4096 };
    let comparisons = 0;
    while (comparisons < 2048 && candidate <= source.length - text.length) {
      comparisons++;
      if (source.charCodeAt(candidate + offset) === text.charCodeAt(offset)) {
        if (++offset === text.length) {
          found = candidate;
          break;
        }
      } else {
        candidate++;
        offset = 0;
      }
    }
    yield {
      type: "settle",
      bytes: comparisons * 6,
      visits: 1,
      scalars: comparisons * 2,
    };
  }
  return found;
}
function* titleExcerpt(
  title: string,
  match: SearchExcerpt | null,
  maximum = 500,
): Generator<WorkEvent, SearchExcerpt, void> {
  if (title.length > maximum) throw new Error("Invalid admitted title.");
  const offset = match ? yield* findText(title, match.text) : -1;
  return yield* work(
    4096,
    1,
    () =>
      Object.freeze({
        text: title,
        matches: Object.freeze(
          offset < 0
            ? []
            : match!.matches.map((range) =>
                Object.freeze({
                  from: range.from + offset,
                  to: range.to + offset,
                }),
              ),
        ),
        before: false,
        after: false,
      }),
    title.length,
  );
}

type Matched = { mask: number; primary: boolean; hit?: SearchHit };
function* matchNote(
  state: State,
  ordinal: number,
  project: boolean,
): Generator<WorkEvent, Matched, void> {
  const reader = state.reader!,
    query = state.query!,
    note = yield* read(() => reader.note(ordinal));
  const title = yield* scan(query, (emit) => plain(note.title, emit));
  let mask = title.mask;
  const secondary: SearchExcerpt[] = [];
  for (const tag of note.tags) {
    const part = yield* scan(query, (emit) => plain(tag, emit));
    mask |= part.mask;
    if (project && part.excerpt && secondary.length < 3)
      secondary.push(part.excerpt);
  }
  const body = yield* scan(query, (emit) => document(state, note.root, emit));
  mask |= body.mask;
  if (project && body.excerpt && secondary.length < 3)
    secondary.push(body.excerpt);
  const hit = project
    ? Object.freeze({
        locator: Object.freeze({
          kind: "note" as const,
          accountId: reader.versions.accountId,
          libraryEpoch: reader.versions.library.epoch,
          noteId: note.id,
        }),
        entityRevision: note.revision,
        primary: yield* titleExcerpt(note.title, title.excerpt),
        secondary: Object.freeze(secondary),
      })
    : undefined;
  return { mask, primary: title.mask !== 0, hit };
}
function* matchClip(
  state: State,
  ordinal: number,
  project: boolean,
): Generator<WorkEvent, Matched, void> {
  const reader = state.reader!,
    query = state.query!,
    clip = yield* read(() => reader.clip(ordinal)),
    title = yield* scan(query, (emit) => plain(clip.title, emit));
  let mask = title.mask;
  const secondary: SearchExcerpt[] = [];
  for (const value of [clip.originalUrl, clip.canonicalUrl, clip.text]) {
    if (value === null) continue;
    const part = yield* scan(query, (emit) => plain(value, emit));
    mask |= part.mask;
    if (project && part.excerpt && secondary.length < 3)
      secondary.push(part.excerpt);
  }
  return {
    mask,
    primary: title.mask !== 0,
    hit: project
      ? Object.freeze({
          locator: Object.freeze({
            kind: "clip" as const,
            accountId: reader.versions.accountId,
            collectionsEpoch: reader.versions.collections.epoch,
            clipId: clip.id,
          }),
          entityRevision: clip.revision,
          primary: yield* titleExcerpt(clip.title, title.excerpt),
          secondary: Object.freeze(secondary),
          archived: clip.archivedAt !== null,
          clipContent:
            clip.text === null
              ? ("link-only" as const)
              : ("saved-text" as const),
        })
      : undefined,
  };
}
function* matchCard(
  state: State,
  card: SearchCardView,
  project: boolean,
): Generator<WorkEvent, Matched, void> {
  const reader = state.reader!,
    query = state.query!,
    entry = yield* state.entries.get(card.entryId);
  if (!entry) throw new Error("Missing admitted entry.");
  const deck = yield* state.decks.get(entry.view.deckId);
  if (!deck) throw new Error("Missing admitted deck.");
  const front = yield* scan(query, (emit) =>
    cardField(entry, card.key, true, emit),
  );
  let mask = front.mask;
  const secondary: SearchExcerpt[] = [];
  const back = yield* scan(query, (emit) =>
    cardField(entry, card.key, false, emit),
  );
  mask |= back.mask;
  if (project && back.excerpt) secondary.push(back.excerpt);
  const deckMatch = yield* scan(query, (emit) => plain(deck.title, emit));
  mask |= deckMatch.mask;
  if (project && deckMatch.excerpt)
    secondary.push(yield* titleExcerpt(deck.title, deckMatch.excerpt, 1000));
  for (const tag of entry.view.tags) {
    const part = yield* scan(query, (emit) => plain(tag, emit));
    mask |= part.mask;
    if (project && part.excerpt && secondary.length < 3)
      secondary.push(part.excerpt);
  }
  return {
    mask,
    primary: front.mask !== 0,
    hit: project
      ? Object.freeze({
          locator: Object.freeze({
            kind: "card" as const,
            accountId: reader.versions.accountId,
            collectionsEpoch: reader.versions.collections.epoch,
            cardId: card.id,
            entryId: card.entryId,
            key: card.key,
          }),
          entityRevision: card.revision,
          primary: front.excerpt ?? front.preview,
          secondary: Object.freeze(secondary),
          deckTitle: deck.title,
        })
      : undefined,
  };
}
function* compareText(
  a: string,
  b: string,
): Generator<WorkEvent, number, void> {
  for (let from = 0; from < Math.min(a.length, b.length);) {
    const to = Math.min(a.length, b.length, from + 2048);
    const result = yield* work(
      (to - from) * 6,
      1,
      () => {
        for (let i = from; i < to; i++) {
          const delta = a.charCodeAt(i) - b.charCodeAt(i);
          if (delta) return delta;
        }
        return 0;
      },
      (to - from) * 2,
    );
    if (result) return result;
    from = to;
  }
  return a.length - b.length;
}
function* compare(
  a: Row,
  b: Row,
  kind: SearchKind,
): Generator<WorkEvent, number, void> {
  yield* work(32, 1, () => undefined);
  if (a.primary !== b.primary) return a.primary ? -1 : 1;
  if (kind !== "card") {
    const date = yield* compareText(b.updatedAt, a.updatedAt);
    if (date) return date;
  }
  const title = yield* compareText(a.title, b.title);
  if (title) return title;
  return kind === "card"
    ? a.entryOrdinal - b.entryOrdinal || a.ordinal - b.ordinal
    : a.ordinal - b.ordinal;
}
function* order(
  rows: Row[],
  kind: SearchKind,
): Generator<WorkEvent, Row[], void> {
  let source = rows,
    target = yield* work(
      rows.length * 8 + 32,
      1,
      () => new Array<Row>(rows.length),
    );
  for (let width = 1; width < rows.length; width *= 2) {
    for (let start = 0; start < rows.length; start += width * 2) {
      let left = start,
        right = Math.min(start + width, rows.length),
        end = Math.min(start + width * 2, rows.length),
        middle = right;
      for (let position = start; position < end; position++) {
        const useLeft =
          left < middle &&
          (right >= end ||
            (yield* compare(source[left]!, source[right]!, kind)) <= 0);
        yield* work(16, 1, () => {
          target[position] = source[useLeft ? left++ : right++]!;
        });
      }
    }
    const old = source;
    source = target;
    target = old;
  }
  return source;
}
export function* buildSearchIndex(
  reader: SearchSourceReader,
  query: SearchQuery,
  onProgress?: (progress: SearchProgress) => void,
): Generator<WorkEvent, SearchIndex, void> {
  const state: State = {
    reader,
    query,
    notes: new SearchIdentityMap(),
    entries: new SearchIdentityMap(),
    decks: new SearchIdentityMap(),
    noteRows: [],
    clipRows: [],
    cardRows: [],
    disposed: false,
    pages: new Set(),
  };
  let completed = false;
  const total = reader.counts.notes + reader.counts.clips + reader.counts.cards;
  let checked = 0;
  const progress = (phase: SearchProgress["phase"]) =>
    onProgress?.(
      Object.freeze({ phase, checkedEntities: checked, totalEntities: total }),
    );
  try {
    progress("indexing");
    for (let i = 0; i < reader.counts.notes; i++) {
      const note = yield* read(() => reader.note(i));
      yield* state.notes.set(note.id, note);
    }
    for (let i = 0; i < reader.counts.decks; i++) {
      const deck = yield* read(() => reader.deck(i));
      yield* state.decks.set(deck.id, deck);
    }
    for (let i = 0; i < reader.counts.entries; i++) {
      const view = yield* read(() => reader.entry(i)),
        segments =
          view.type === "cloze" ? yield* parseCloze(reader, view) : null;
      yield* state.entries.set(view.id, { ordinal: i, view, segments });
    }
    const wanted = (1 << query.terms.length) - 1;
    progress("matching");
    for (let i = 0; i < reader.counts.notes; i++) {
      const found = yield* matchNote(state, i, false);
      if (found.mask === wanted) {
        const note = yield* read(() => reader.note(i));
        yield* work(96, 1, () =>
          state.noteRows.push({
            ordinal: i,
            primary: found.primary,
            title: note.title,
            updatedAt: note.updatedAt,
            entryOrdinal: 0,
            card: null,
          }),
        );
      }
      checked++;
      progress("matching");
    }
    for (let i = 0; i < reader.counts.clips; i++) {
      const found = yield* matchClip(state, i, false);
      if (found.mask === wanted) {
        const clip = yield* read(() => reader.clip(i));
        yield* work(96, 1, () =>
          state.clipRows.push({
            ordinal: i,
            primary: found.primary,
            title: clip.title,
            updatedAt: clip.updatedAt,
            entryOrdinal: 0,
            card: null,
          }),
        );
      }
      checked++;
      progress("matching");
    }
    for (let i = 0; i < reader.counts.cards; i++) {
      const card = yield* read(() => reader.card(i)),
        found = yield* matchCard(state, card, false);
      if (found.mask === wanted) {
        const entry = (yield* state.entries.get(card.entryId))!,
          deck = (yield* state.decks.get(entry.view.deckId))!;
        yield* work(96, 1, () =>
          state.cardRows.push({
            ordinal: i,
            primary: found.primary,
            title: deck.title,
            updatedAt: "",
            entryOrdinal: entry.ordinal,
            card,
          }),
        );
      }
      checked++;
      progress("matching");
    }
    progress("ordering");
    state.noteRows = yield* order(state.noteRows, "note");
    state.clipRows = yield* order(state.clipRows, "clip");
    state.cardRows = yield* order(state.cardRows, "card");
    const index = Object.freeze({}) as SearchIndex;
    states.set(index, state);
    completed = true;
    return index;
  } finally {
    if (!completed) clear(state);
  }
}
export function searchIndexCounts(index: SearchIndex): SearchCounts {
  const state = stateOf(index),
    notes = state.noteRows.length,
    clips = state.clipRows.length,
    cards = state.cardRows.length;
  return Object.freeze({ notes, clips, cards, all: notes + clips + cards });
}
function* projectPage(
  index: SearchIndex,
  kind: SearchKind,
  offset: number,
  limit: number,
): Generator<WorkEvent, readonly SearchHit[], void> {
  if (
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 50
  )
    throw new Error("Invalid search page.");
  const state = stateOf(index),
    rows =
      kind === "note"
        ? state.noteRows
        : kind === "clip"
          ? state.clipRows
          : kind === "card"
            ? state.cardRows
            : null;
  if (!rows) throw new Error("Invalid search kind.");
  const result: SearchHit[] = [];
  for (let i = offset; i < Math.min(offset + limit, rows.length); i++) {
    stateOf(index);
    const row = rows[i]!,
      found =
        kind === "note"
          ? yield* matchNote(state, row.ordinal, true)
          : kind === "clip"
            ? yield* matchClip(state, row.ordinal, true)
            : yield* matchCard(state, row.card!, true);
    stateOf(index);
    if (!found.hit) throw new Error("Invalid search projection.");
    yield* work(32, 1, () => result.push(found.hit!));
  }
  return Object.freeze(result);
}

export function projectSearchPage(
  index: SearchIndex,
  kind: SearchKind,
  offset: number,
  limit: number,
): Generator<WorkEvent, readonly SearchHit[], void> {
  const state = stateOf(index);
  let iterator!: Generator<WorkEvent, readonly SearchHit[], void>;
  iterator = (function* (): Generator<WorkEvent, readonly SearchHit[], void> {
    try {
      return yield* projectPage(index, kind, offset, limit);
    } finally {
      state.pages.delete(iterator);
    }
  })();
  state.pages.add(iterator);
  return iterator;
}
