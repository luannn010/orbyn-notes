import type { NotesLibraryStore } from "../library/contracts";
import type { CollectionsStore } from "../collections/contracts";
import { onLock } from "../account/session";
import type {
  SearchInvalidation,
  SearchLease,
  SearchSourceReader,
} from "./contracts";
import { SearchSourceError } from "./contracts";
import {
  acquireSearchSource,
  assertSearchSourceFresh,
  onSearchSourceInvalidated,
  releaseSearchSource,
  searchSourceReader,
} from "./source";
import {
  buildSearchIndex,
  disposeSearchIndex,
  projectSearchPage,
  searchIndexCounts,
  type SearchIndex,
} from "./model";
import { compileSearchQuery, SearchQueryError, type SearchQuery } from "./text";
import { SearchWork, type WorkEvent } from "./work";
import type {
  LocalSearchService,
  SearchCursor,
  SearchGroup,
  SearchHandle,
  SearchHit,
  SearchKind,
  SearchPageIntent,
  SearchProgress,
  SearchState,
} from "./results";

type Ready = Extract<SearchState, { status: "ready" }>;
type InitialResult = Readonly<{
  groups: readonly Readonly<{
    kind: SearchKind;
    offset: number;
    items: readonly SearchHit[];
  }>[];
}>;
type Job = {
  generation: number;
  raw: string;
  initialPages: SearchPageIntent;
  lease: SearchLease;
  index: SearchIndex | null;
  handle: SearchHandle;
  reader: SearchSourceReader;
  progress: SearchProgress | null;
  busy: object | null;
  work: SearchWork<InitialResult> | null;
  page: {
    handle: SearchHandle;
    kind: SearchKind;
    offset: number;
    work: SearchWork<readonly SearchHit[]>;
  } | null;
  unsubscribe: () => void;
};
type CursorState = {
  job: Job;
  kind: SearchKind;
  origin: number;
  offset: number;
  consumed: boolean;
};
const kinds: readonly SearchKind[] = ["note", "clip", "card"];
const pageSize = 50;
function capturePageIntent(input?: SearchPageIntent): SearchPageIntent {
  const result: Partial<Record<SearchKind, number>> = {};
  for (const kind of kinds) {
    const value = input?.[kind];
    if (value === undefined) continue;
    if (
      !Number.isSafeInteger(value) ||
      value < 0 ||
      value > 20000 ||
      value % pageSize !== 0
    )
      throw new SearchActionError("invalid-handle");
    result[kind] = value;
  }
  return Object.freeze(result);
}
const idle = (): SearchState => Object.freeze({ status: "idle", raw: "" });
const handle = (): SearchHandle => Object.freeze({}) as SearchHandle;
const countFor = (ready: Ready, kind: SearchKind) =>
  ready.counts[kind === "note" ? "notes" : kind === "clip" ? "clips" : "cards"];

export class SearchActionError extends Error {
  constructor(public readonly code: "invalid-handle" | "busy" | "closed") {
    super(
      code === "busy"
        ? "Search work is already running."
        : "This search action is no longer available.",
    );
    this.name = "SearchActionError";
  }
}

/** Real owner inputs only; there is no fixture mode or caller-admitted corpus.
 * A ready certificate belongs to one exact independently verified version pair. */
export function createLocalSearchService(
  notes: NotesLibraryStore,
  collections: CollectionsStore,
): LocalSearchService {
  let state = idle();
  let generation = 0,
    closed = false;
  let job: Job | null = null;
  let cursors = new WeakMap<SearchCursor, CursorState>();
  const listeners = new Set<() => void>();
  const invalidations = new Set<(reason: SearchInvalidation) => void>();
  function notify(): void {
    for (const listener of [...listeners]) {
      try {
        listener();
      } catch {
        /* One observer cannot block revocation. */
      }
    }
  }
  function publish(next: SearchState): void {
    state = Object.freeze(next);
    notify();
  }
  function current(candidate: Job): void {
    if (closed || job !== candidate || candidate.generation !== generation)
      throw new DOMException("Search stopped.", "AbortError");
  }
  function dispose(): void {
    const old = job;
    job = null;
    cursors = new WeakMap();
    if (!old) return;
    old.unsubscribe();
    old.work?.close();
    old.page?.work.close();
    old.work = null;
    old.page = null;
    if (old.index) disposeSearchIndex(old.index);
    old.index = null;
    releaseSearchSource(old.lease);
  }
  function invalidate(reason: SearchInvalidation): void {
    const raw = reason === "changed" ? state.raw : "";
    generation++;
    dispose();
    state =
      reason === "changed" ? Object.freeze({ status: "changed", raw }) : idle();
    // Privacy listeners clear held route/query projections before ordinary UI
    // subscriptions can observe the new state.
    for (const listener of [...invalidations]) {
      try {
        listener(reason);
      } catch {
        /* Continue clearing all consumers. */
      }
    }
    notify();
  }
  function cursor(
    candidate: Job,
    kind: SearchKind,
    origin: number,
    offset: number,
    total: number,
  ): SearchCursor | null {
    if (offset < 0 || offset >= total) return null;
    const value = Object.freeze({}) as SearchCursor;
    cursors.set(value, {
      job: candidate,
      kind,
      origin,
      offset,
      consumed: false,
    });
    return value;
  }
  function retainedPage(candidate: Job, ready: Ready, kind: SearchKind): Ready {
    return Object.freeze({
      ...ready,
      page: null,
      groups: Object.freeze(
        ready.groups.map((group) =>
          group.kind !== kind
            ? group
            : Object.freeze({
                ...group,
                previous: cursor(
                  candidate,
                  group.kind,
                  group.offset,
                  group.offset - pageSize,
                  countFor(ready, group.kind),
                ),
                next: cursor(
                  candidate,
                  group.kind,
                  group.offset,
                  group.offset + group.items.length,
                  countFor(ready, group.kind),
                ),
              }),
        ),
      ),
    });
  }
  function* initial(
    candidate: Job,
    query: SearchQuery,
  ): Generator<WorkEvent, InitialResult, void> {
    candidate.index = yield* buildSearchIndex(
      candidate.reader,
      query,
      (progress) => {
        candidate.progress = progress;
      },
    );
    const counts = searchIndexCounts(candidate.index);
    const groups: {
      kind: SearchKind;
      offset: number;
      items: readonly SearchHit[];
    }[] = [];
    for (const kind of kinds) {
      const total =
        counts[kind === "note" ? "notes" : kind === "clip" ? "clips" : "cards"];
      const lastPage =
        total === 0 ? 0 : Math.floor((total - 1) / pageSize) * pageSize;
      const offset = Math.min(candidate.initialPages[kind] ?? 0, lastPage);
      const items = yield* projectSearchPage(
        candidate.index,
        kind,
        offset,
        pageSize,
      );
      groups.push(Object.freeze({ kind, offset, items }));
    }
    return Object.freeze({ groups: Object.freeze(groups) });
  }
  function fail(candidate: Job, error: unknown, aborted = false): void {
    if (job !== candidate || candidate.generation !== generation) return;
    const raw = candidate.raw;
    generation++;
    dispose();
    publish(
      aborted || (error instanceof DOMException && error.name === "AbortError")
        ? idle()
        : { status: "error", raw, code: "source-unavailable" },
    );
  }
  async function runInitial(
    candidate: Job,
    signal?: AbortSignal,
  ): Promise<void> {
    if (candidate.busy) throw new SearchActionError("busy");
    const operation = {};
    candidate.busy = operation;
    let proving = false;
    try {
      current(candidate);
      publish({
        status: "pending",
        raw: candidate.raw,
        progress: candidate.progress,
      });
      proving = true;
      await assertSearchSourceFresh(candidate.lease, signal);
      current(candidate);
      proving = false;
      const result = await candidate.work!.round(signal);
      current(candidate);
      proving = true;
      await assertSearchSourceFresh(candidate.lease, signal);
      current(candidate);
      proving = false;
      if (result.status === "paused") {
        publish({
          status: "paused-limit",
          raw: candidate.raw,
          handle: candidate.handle,
          progress: candidate.progress,
        });
        return;
      }
      const counts = Object.freeze(searchIndexCounts(candidate.index!));
      const groups: readonly SearchGroup[] = Object.freeze(
        result.value.groups.map((group) =>
          Object.freeze({
            ...group,
            previous: cursor(
              candidate,
              group.kind,
              group.offset,
              group.offset - pageSize,
              counts[
                group.kind === "note"
                  ? "notes"
                  : group.kind === "clip"
                    ? "clips"
                    : "cards"
              ],
            ),
            next: cursor(
              candidate,
              group.kind,
              group.offset,
              group.offset + group.items.length,
              counts[
                group.kind === "note"
                  ? "notes"
                  : group.kind === "clip"
                    ? "clips"
                    : "cards"
              ],
            ),
          }),
        ),
      );
      candidate.work = null;
      publish({
        status: "ready",
        raw: candidate.raw,
        handle: candidate.handle,
        versions: candidate.reader.versions,
        counts,
        groups,
        page: null,
      });
    } catch (error) {
      if (
        proving &&
        !signal?.aborted &&
        job === candidate &&
        candidate.generation === generation &&
        !(error instanceof DOMException && error.name === "AbortError")
      )
        invalidate("unverified");
      else fail(candidate, error, signal?.aborted);
    } finally {
      if (candidate.busy === operation) candidate.busy = null;
    }
  }
  async function runPage(candidate: Job, signal?: AbortSignal): Promise<void> {
    if (candidate.busy) throw new SearchActionError("busy");
    if (!candidate.page || state.status !== "ready")
      throw new SearchActionError("invalid-handle");
    const operation = {};
    candidate.busy = operation;
    const pending = candidate.page;
    let proving = false;
    const pageCurrent = () => {
      current(candidate);
      if (candidate.page !== pending)
        throw new DOMException("Search page stopped.", "AbortError");
    };
    try {
      pageCurrent();
      publish({
        ...state,
        page: Object.freeze({ status: "pending", kind: pending.kind }),
      });
      proving = true;
      await assertSearchSourceFresh(candidate.lease, signal);
      pageCurrent();
      proving = false;
      const result = await pending.work.round(signal);
      pageCurrent();
      proving = true;
      await assertSearchSourceFresh(candidate.lease, signal);
      pageCurrent();
      proving = false;
      if (state.status !== "ready")
        throw new SearchActionError("invalid-handle");
      if (result.status === "paused") {
        publish({
          ...state,
          page: Object.freeze({
            status: "paused",
            kind: pending.kind,
            handle: pending.handle,
          }),
        });
        return;
      }
      const ready = state;
      const groups = Object.freeze(
        ready.groups.map((group) =>
          group.kind !== pending.kind
            ? group
            : Object.freeze({
                kind: group.kind,
                items: result.value,
                offset: pending.offset,
                previous: cursor(
                  candidate,
                  group.kind,
                  pending.offset,
                  pending.offset - pageSize,
                  countFor(ready, group.kind),
                ),
                next: cursor(
                  candidate,
                  group.kind,
                  pending.offset,
                  pending.offset + result.value.length,
                  countFor(ready, group.kind),
                ),
              }),
        ),
      );
      candidate.page = null;
      publish({ ...ready, groups, page: null });
    } catch (error) {
      if (
        job !== candidate ||
        candidate.generation !== generation ||
        candidate.page !== pending
      )
        return;
      if (
        proving &&
        !signal?.aborted &&
        !(error instanceof DOMException && error.name === "AbortError")
      ) {
        invalidate("unverified");
        return;
      }
      if (state.status !== "ready") {
        fail(candidate, error);
        return;
      }
      pending.work.close();
      if (
        signal?.aborted ||
        (error instanceof DOMException && error.name === "AbortError")
      ) {
        candidate.page = null;
        publish(retainedPage(candidate, state, pending.kind));
      } else {
        // Retain the completed page/certificate. Retry gets a new iterator over
        // this same captured index; it never restarts the entire query budget.
        pending.work = new SearchWork(
          projectSearchPage(
            candidate.index!,
            pending.kind,
            pending.offset,
            pageSize,
          ),
          undefined,
          undefined,
          () => current(candidate),
        );
        publish({
          ...state,
          page: Object.freeze({
            status: "error",
            kind: pending.kind,
            handle: pending.handle,
          }),
        });
      }
    } finally {
      if (candidate.busy === operation) candidate.busy = null;
    }
  }
  const unsubscribeLock = onLock(() => {
    if (!closed && (job || state.status !== "idle")) invalidate("closed");
  });
  return {
    getSnapshot: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    onInvalidate(listener) {
      invalidations.add(listener);
      return () => {
        invalidations.delete(listener);
      };
    },
    async query(raw, signal, initialPages) {
      if (closed) throw new SearchActionError("closed");
      generation++;
      const ownGeneration = generation;
      dispose();
      let query: SearchQuery | null;
      let pages: SearchPageIntent;
      try {
        pages = capturePageIntent(initialPages);
        initialPages = undefined;
        query = compileSearchQuery(raw);
      } catch (error) {
        if (!(error instanceof SearchQueryError)) {
          publish(idle());
          throw error;
        }
        publish({ status: "error", raw, code: error.code });
        return;
      }
      if (!query || signal?.aborted) {
        publish(idle());
        return;
      }
      publish({ status: "pending", raw, progress: null });
      let acquired: SearchLease | null = null;
      try {
        acquired = await acquireSearchSource(notes, collections, signal);
        if (closed || generation !== ownGeneration || signal?.aborted) {
          releaseSearchSource(acquired);
          acquired = null;
          if (!closed && generation === ownGeneration) publish(idle());
          return;
        }
        const reader = searchSourceReader(acquired);
        const candidate: Job = {
          generation: ownGeneration,
          raw,
          initialPages: pages,
          lease: acquired,
          reader,
          index: null,
          handle: handle(),
          progress: null,
          busy: null,
          work: null,
          page: null,
          unsubscribe: () => {},
        };
        job = candidate;
        acquired = null;
        candidate.unsubscribe = onSearchSourceInvalidated(
          candidate.lease,
          (reason) => {
            if (job === candidate && generation === candidate.generation)
              invalidate(reason);
          },
        );
        candidate.work = new SearchWork(
          initial(candidate, query),
          undefined,
          undefined,
          () => current(candidate),
        );
        await runInitial(candidate, signal);
      } catch (error) {
        if (acquired) releaseSearchSource(acquired);
        if (job?.generation === ownGeneration) {
          fail(job, error, signal?.aborted);
          return;
        }
        if (!closed && generation === ownGeneration) {
          if (
            signal?.aborted ||
            (error instanceof DOMException && error.name === "AbortError")
          )
            publish(idle());
          else if (
            error instanceof SearchSourceError &&
            (error.code === "search_source_revoked" ||
              error.code === "search_source_changed" ||
              error.code === "search_source_invalid")
          )
            invalidate("unverified");
          else publish({ status: "error", raw, code: "source-unavailable" });
        }
      }
    },
    async continue(value, signal) {
      if (closed) throw new SearchActionError("closed");
      const candidate = job;
      if (!candidate) throw new SearchActionError("invalid-handle");
      if (candidate.busy) throw new SearchActionError("busy");
      if (
        candidate.page?.handle === value &&
        state.status === "ready" &&
        (state.page?.status === "paused" || state.page?.status === "error")
      ) {
        await runPage(candidate, signal);
        return;
      }
      if (
        candidate.handle !== value ||
        state.status !== "paused-limit" ||
        !candidate.work
      )
        throw new SearchActionError("invalid-handle");
      await runInitial(candidate, signal);
    },
    async page(value, signal) {
      if (closed) throw new SearchActionError("closed");
      const candidate = job,
        selected = cursors.get(value);
      if (
        !candidate ||
        !selected ||
        selected.job !== candidate ||
        selected.consumed ||
        state.status !== "ready" ||
        !candidate.index ||
        state.groups.find((group) => group.kind === selected.kind)?.offset !==
          selected.origin
      )
        throw new SearchActionError("invalid-handle");
      if (candidate.busy || candidate.page) throw new SearchActionError("busy");
      selected.consumed = true;
      const pageHandle = handle();
      candidate.page = {
        handle: pageHandle,
        kind: selected.kind,
        offset: selected.offset,
        work: new SearchWork(
          projectSearchPage(
            candidate.index,
            selected.kind,
            selected.offset,
            pageSize,
          ),
          undefined,
          undefined,
          () => current(candidate),
        ),
      };
      await runPage(candidate, signal);
    },
    cancelPage() {
      if (closed || !job?.page || state.status !== "ready") return;
      const pending = job.page;
      job.page = null;
      // Retire this operation's admission immediately. Its late proof/result
      // and finally are fenced by the page identity and operation token.
      job.busy = null;
      pending.work.close();
      publish(retainedPage(job, state, pending.kind));
    },
    cancel() {
      if (closed) return;
      generation++;
      dispose();
      publish(idle());
    },
    close() {
      if (closed) return;
      closed = true;
      unsubscribeLock();
      invalidate("closed");
      listeners.clear();
      invalidations.clear();
    },
  };
}
