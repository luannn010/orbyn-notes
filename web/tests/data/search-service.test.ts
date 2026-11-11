import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NotesLibraryStore } from "../../src/library/contracts";
import type { CollectionsStore } from "../../src/collections/contracts";
import type { SearchHandle, SearchState } from "../../src/search/results";
import { createLocalSearchService } from "../../src/search/service";
import { lock } from "../../src/account/session";
import { SearchSourceError } from "../../src/search/contracts";

// These mocks isolate service lifecycle/round/cursor contracts. Real encrypted
// source and corpus matching are qualified in their own integration suites.
const mock = vi.hoisted(() => ({
  acquire: vi.fn(),
  fresh: vi.fn(),
  release: vi.fn(),
  dispose: vi.fn(),
  listener: null as
    null | ((reason: "changed" | "epoch" | "closed" | "unverified") => void),
  pause: false,
  pageError: false,
  noteCount: 101,
}));
vi.mock("../../src/search/source", () => ({
  acquireSearchSource: mock.acquire,
  assertSearchSourceFresh: mock.fresh,
  releaseSearchSource: mock.release,
  onSearchSourceInvalidated: (
    _lease: unknown,
    listener: typeof mock.listener,
  ) => {
    mock.listener = listener;
    return () => {
      mock.listener = null;
    };
  },
  searchSourceReader: () => ({
    versions: {
      accountId: "account",
      library: { epoch: "notes-epoch", revision: 1 },
      collections: { epoch: "different-collections-epoch", revision: 2 },
    },
  }),
}));
vi.mock("../../src/search/model", () => ({
  buildSearchIndex: function* () {
    for (const cost of mock.pause
      ? [32 * 1024 * 1024, 40 * 1024 * 1024]
      : [1]) {
      yield { type: "reserve", bytes: cost, visits: 1, scalars: 0 };
      yield { type: "settle", bytes: cost, visits: 1, scalars: 0 };
    }
    return {};
  },
  searchIndexCounts: () => ({
    notes: mock.noteCount,
    clips: 0,
    cards: 0,
    all: mock.noteCount,
  }),
  disposeSearchIndex: mock.dispose,
  projectSearchPage: function* (
    _index: unknown,
    kind: string,
    offset: number,
    limit: number,
  ) {
    if (mock.pageError && offset > 0) throw new Error("Projection failed");
    yield { type: "reserve", bytes: 1, visits: 1, scalars: 0 };
    yield { type: "settle", bytes: 1, visits: 1, scalars: 0 };
    return Object.freeze(
      kind === "note"
        ? Array.from(
            { length: Math.min(limit, mock.noteCount - offset) },
            (_, i) =>
              Object.freeze({
                locator: {
                  kind: "note",
                  accountId: "account",
                  libraryEpoch: "notes-epoch",
                  noteId: `note-${offset + i}`,
                },
                entityRevision: 1,
                primary: {
                  text: `Note ${offset + i}`,
                  matches: [],
                  before: false,
                  after: false,
                },
                secondary: [],
              }),
          )
        : [],
    );
  },
}));
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const service = () =>
  createLocalSearchService({} as NotesLibraryStore, {} as CollectionsStore);
const ready = (state: SearchState) => {
  expect(state.status).toBe("ready");
  if (state.status !== "ready")
    throw new Error("Expected a completed certificate");
  return state;
};
beforeEach(() => {
  mock.noteCount = 101;
  vi.clearAllMocks();
  mock.listener = null;
  mock.pause = false;
  mock.pageError = false;
  mock.acquire.mockResolvedValue({});
  mock.fresh.mockResolvedValue(undefined);
});
describe("local search service lifetime and certificates", () => {
  it("rejects invalid page intent without retaining an old certificate or acquiring source", async () => {
    const search = service();
    await search.query("note");
    mock.acquire.mockClear();
    await expect(
      search.query("note", undefined, { note: -50 }),
    ).rejects.toMatchObject({ code: "invalid-handle" });
    expect(search.getSnapshot()).toEqual({ status: "idle", raw: "" });
    expect(mock.acquire).not.toHaveBeenCalled();
    search.close();
  });
  it("restores numeric page intent through a fresh query without reusing an old certificate/cursor", async () => {
    const search = service();
    await search.query("note");
    await search.page(ready(search.getSnapshot()).groups[0]!.next!);
    const old = ready(search.getSnapshot()),
      oldCursor = old.groups[0]!.next!;
    const held = deferred<object>();
    mock.acquire.mockReturnValueOnce(held.promise);
    const intent = { note: 50 };
    const pending = search.query("note", undefined, intent);
    expect(search.getSnapshot()).toMatchObject({ status: "pending" });
    expect(search.getSnapshot()).not.toHaveProperty("counts");
    intent.note = 0;
    held.resolve({});
    await pending;
    const fresh = ready(search.getSnapshot());
    expect(fresh.handle).not.toBe(old.handle);
    expect(fresh.groups[0]!.offset).toBe(50);
    expect(fresh.groups[0]!.items[0]!.locator).toMatchObject({
      noteId: "note-50",
    });
    await expect(search.page(oldCursor)).rejects.toMatchObject({
      code: "invalid-handle",
    });
    // A shorter genuine new result set clamps the old intent to its last page.
    mock.noteCount = 13;
    await search.query("note", undefined, { note: 100 });
    expect(ready(search.getSnapshot()).groups[0]).toMatchObject({
      offset: 0,
      next: null,
      previous: null,
    });
    expect(ready(search.getSnapshot()).groups[0]!.items).toHaveLength(13);
    search.close();
  });
  it("clears authority rejection before admission and treats SourceLease abort as cancellation", async () => {
    const search = service();
    const revoked = vi.fn();
    search.onInvalidate(revoked);
    mock.acquire.mockRejectedValueOnce(
      new SearchSourceError("search_source_revoked"),
    );
    await search.query("private acquisition query");
    expect(search.getSnapshot()).toEqual({ status: "idle", raw: "" });
    expect(revoked).toHaveBeenCalledWith("unverified");
    revoked.mockClear();
    let reject!: (error: unknown) => void;
    mock.acquire.mockReturnValueOnce(
      new Promise((_resolve, fail) => {
        reject = fail;
      }),
    );
    const controller = new AbortController();
    const pending = search.query("cancel query", controller.signal);
    controller.abort();
    reject(new SearchSourceError("search_source_revoked"));
    await pending;
    expect(search.getSnapshot()).toEqual({ status: "idle", raw: "" });
    expect(revoked).not.toHaveBeenCalled();
    search.close();
  });
  it("clears pending-only query intent on account lock before acquisition resolves", async () => {
    const hold = deferred<object>();
    mock.acquire.mockReturnValueOnce(hold.promise);
    const search = service();
    const pending = search.query("private pending query");
    lock(false);
    expect(search.getSnapshot()).toEqual({ status: "idle", raw: "" });
    const lease = {};
    hold.resolve(lease);
    await pending;
    expect(mock.release).toHaveBeenCalledWith(lease);
    expect(search.getSnapshot()).toEqual({ status: "idle", raw: "" });
    search.close();
  });
  it("treats a failed freshness read as unverified, clearing query and held routes", async () => {
    mock.fresh.mockRejectedValueOnce(new Error("IDB read denied"));
    const search = service();
    const revoked = vi.fn();
    search.onInvalidate(revoked);
    await search.query("private query");
    expect(search.getSnapshot()).toEqual({ status: "idle", raw: "" });
    expect(revoked).toHaveBeenCalledWith("unverified");
    search.close();
  });
  it("keeps blank idle and invalid input visible without acquiring a source", async () => {
    const search = service();
    await search.query(" \t ");
    expect(search.getSnapshot()).toEqual({ status: "idle", raw: "" });
    await search.query("x".repeat(201));
    expect(search.getSnapshot()).toMatchObject({
      status: "error",
      raw: "x".repeat(201),
      code: "query-too-long",
    });
    expect(mock.acquire).not.toHaveBeenCalled();
    search.close();
  });
  it("keeps complete counts while replacing bounded pages and rejects stale/forged cursors", async () => {
    const search = service();
    await search.query("note");
    const first = ready(search.getSnapshot());
    expect(first.counts.all).toBe(101);
    expect(first.groups[0]!.items).toHaveLength(50);
    const next = first.groups[0]!.next!;
    await search.page(next);
    const second = ready(search.getSnapshot());
    expect(second.counts).toEqual(first.counts);
    expect(second.groups[0]).toMatchObject({ offset: 50 });
    expect(second.groups[0]!.items).toHaveLength(50);
    await expect(search.page(next)).rejects.toMatchObject({
      code: "invalid-handle",
    });
    await search.page(second.groups[0]!.previous!);
    expect(ready(search.getSnapshot()).groups[0]!.offset).toBe(0);
    await expect(search.page(second.groups[0]!.next!)).rejects.toMatchObject({
      code: "invalid-handle",
    });
    await expect(search.continue({} as SearchHandle)).rejects.toMatchObject({
      code: "invalid-handle",
    });
    search.close();
  });
  it("runs only one automatic round and prevents overlapping Continue", async () => {
    mock.pause = true;
    const search = service();
    await search.query("note");
    const paused = search.getSnapshot();
    expect(paused.status).toBe("paused-limit");
    expect(paused).not.toHaveProperty("counts");
    if (paused.status !== "paused-limit") throw new Error("Expected pause");
    const hold = deferred<void>();
    mock.fresh.mockReturnValueOnce(hold.promise);
    const continuing = search.continue(paused.handle);
    await expect(search.continue(paused.handle)).rejects.toMatchObject({
      code: "busy",
    });
    hold.resolve();
    await continuing;
    expect(search.getSnapshot().status).toBe("ready");
    search.close();
  });
  it("clears certificates before privacy listeners and distinguishes known change from unverified", async () => {
    const search = service();
    await search.query("secret query");
    const order: string[] = [];
    search.onInvalidate(() => {
      order.push("privacy");
      expect(mock.dispose).toHaveBeenCalled();
      expect(search.getSnapshot()).not.toHaveProperty("counts");
    });
    search.subscribe(() => {
      order.push("ordinary");
    });
    mock.listener!("changed");
    expect(search.getSnapshot()).toEqual({
      status: "changed",
      raw: "secret query",
    });
    expect(order).toEqual(["privacy", "ordinary"]);
    await search.query("secret query");
    order.length = 0;
    mock.listener!("unverified");
    expect(search.getSnapshot()).toEqual({ status: "idle", raw: "" });
    expect(order).toEqual(["privacy", "ordinary"]);
    search.close();
  });
  it("releases a late acquisition after cancel without resurrecting its query", async () => {
    const hold = deferred<object>();
    mock.acquire.mockReturnValueOnce(hold.promise);
    const search = service();
    const pending = search.query("old");
    search.cancel();
    const lease = {};
    hold.resolve(lease);
    await pending;
    expect(mock.release).toHaveBeenCalledWith(lease);
    expect(search.getSnapshot()).toEqual({ status: "idle", raw: "" });
    search.close();
  });
  it("does not publish a completed query after revocation during freshness await", async () => {
    const search = service();
    await search.query("note");
    const hold = deferred<void>();
    mock.fresh.mockReturnValueOnce(hold.promise);
    const cursor = ready(search.getSnapshot()).groups[0]!.next!;
    const pending = search.page(cursor);
    mock.listener!("epoch");
    hold.resolve();
    await pending;
    expect(search.getSnapshot()).toEqual({ status: "idle", raw: "" });
    search.close();
  });
  it("retains the prior completed page on projection error, retry and cancellation", async () => {
    const search = service();
    await search.query("note");
    const first = ready(search.getSnapshot());
    mock.pageError = true;
    await search.page(first.groups[0]!.next!);
    const failed = ready(search.getSnapshot());
    expect(failed.page?.status).toBe("error");
    expect(failed.groups).toBe(first.groups);
    expect(failed.counts).toBe(first.counts);
    if (failed.page?.status !== "error") throw new Error("Expected retry");
    mock.pageError = false;
    await search.continue(failed.page.handle);
    expect(ready(search.getSnapshot()).groups[0]!.offset).toBe(50);
    const hold = deferred<void>();
    mock.fresh.mockReturnValueOnce(hold.promise);
    const pending = search.page(ready(search.getSnapshot()).groups[0]!.next!);
    search.cancelPage();
    expect(ready(search.getSnapshot()).page).toBe(null);
    const newer = deferred<void>();
    mock.fresh.mockReturnValueOnce(newer.promise);
    const newerPage = search
      .page(ready(search.getSnapshot()).groups[0]!.next!)
      .then(
        () => null,
        (error) => error,
      );
    hold.resolve();
    await pending;
    expect(ready(search.getSnapshot()).groups[0]!.offset).toBe(50);
    expect(ready(search.getSnapshot()).page?.status).toBe("pending");
    // Late old finally cannot clear a newer operation's admission guard.
    await expect(search.continue({} as SearchHandle)).rejects.toMatchObject({
      code: "busy",
    });
    newer.resolve();
    expect(await newerPage).toBe(null);
    expect(ready(search.getSnapshot()).groups[0]!.offset).toBe(100);
    search.close();
  });
});
