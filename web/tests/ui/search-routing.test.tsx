import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Note, NotesStore } from "../../src/domain/contracts";
import type {
  NotesLibrary,
  NotesLibraryStore,
  LibrarySnapshot,
} from "../../src/library/contracts";
import type { NoteLinkService, NoteTarget } from "../../src/links/contracts";
import type { NoteLinkNavigator } from "../../src/links/navigation";
import type { SearchState, LocalSearchService } from "../../src/search/results";
import type { SearchInvalidation } from "../../src/search/contracts";
import { Workspace } from "../../src/ui/Workspace";
import { registerCloseGuard } from "../../src/desktop/closeGuard";
import type { NoteExportIntent } from "../../src/links/contracts";
import { buildDownload } from "../../src/ui/download";
const model = vi.hoisted(() => ({
  service: null as NoteLinkService | null,
  noteMounts: new Map<string, number>(),
  noteUnmounts: new Map<string, number>(),
  searchState: { status: "idle", raw: "" } as SearchState,
  searchService: null as LocalSearchService | null,
  searchInvalidate: null as ((reason: SearchInvalidation) => void) | null,
  searchListeners: new Set<() => void>(),
  linkBoot: true,
  sourceBoot: true,
  invalidate: null as ((reason: "epoch" | "closed") => void) | null,
}));
vi.mock("../../src/ui/noteLinkOwner", () => ({
  useNoteLinkOwner: (
    _owner: unknown,
    onInvalidate: (reason: "epoch" | "closed") => void,
  ) => {
    model.invalidate = onInvalidate;
    return {
      service: model.service,
      error: "",
      bootSettled: model.linkBoot,
      retry: vi.fn(),
    };
  },
}));
vi.mock("../../src/ui/studySourceOwners", () => ({
  useStudySourceOwners: () => ({
    service: null,
    collections: null,
    error: "",
    bootSettled: model.sourceBoot,
    retry: vi.fn(),
  }),
}));
vi.mock("../../src/ui/localSearchOwner", async () => {
  const React = await import("react");
  return {
    useLocalSearchOwner: (
      _owner: unknown,
      _collections: unknown,
      invalidate: (reason: SearchInvalidation) => void,
    ) => {
      model.searchInvalidate = invalidate;
      const state = React.useSyncExternalStore(
        (listener) => {
          model.searchListeners.add(listener);
          return () => {
            model.searchListeners.delete(listener);
          };
        },
        () => model.searchState,
      );
      return {
        service: model.searchService,
        state,
        error: false,
        retry: vi.fn(),
      };
    },
  };
});
vi.mock("../../src/ui/download", () => ({
  buildDownload: vi.fn(() => ({
    blob: new Blob(["legacy"]),
    name: "legacy.md",
  })),
}));
vi.mock("../../src/ui/NoteEditor", async () => {
  const React = await import("react");
  return {
    NoteEditor: (
      props: Parameters<typeof import("../../src/ui/NoteEditor").NoteEditor>[0],
    ) => {
      const [value, setValue] = React.useState(0);
      React.useEffect(() => {
        model.noteMounts.set(
          props.note.id,
          (model.noteMounts.get(props.note.id) ?? 0) + 1,
        );
        return () => {
          model.noteUnmounts.set(
            props.note.id,
            (model.noteUnmounts.get(props.note.id) ?? 0) + 1,
          );
        };
      }, []);
      return (
        <section>
          <h2>Editor {props.note.title}</h2>
          <div role="textbox" aria-label="Note content" tabIndex={0} />
          <output>
            Actor state {props.note.id} {value}
          </output>
          <button onClick={() => setValue(value + 1)}>
            Advance actor state
          </button>
          <button onClick={() => props.onExport(props.note)}>
            Export this note
          </button>
        </section>
      );
    },
  };
});
const epoch = "22222222-2222-4222-8222-222222222222",
  account = "11111111-1111-4111-8111-111111111111";
const note = (id: string): Note => ({
  id,
  title: id,
  revision: 1,
  tags: [],
  createdAt: "2026-11-11T00:00:00Z",
  updatedAt: "2026-11-11T00:00:00Z",
  trashedAt: null,
  document: { type: "doc", content: [{ type: "paragraph" }] },
});
const a = note("A"),
  b = note("B"),
  snapshot: LibrarySnapshot = {
    token: { epoch, revision: 1 },
    notes: [a, b],
    metadata: [],
    tags: [],
    preferences: { sort: "edited" },
  };
const target = (noteId: string): NoteTarget => ({
  kind: "note",
  accountId: account,
  libraryEpoch: epoch,
  noteId,
});
function held<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
function fixture() {
  const library: NotesLibrary = {
    read: vi.fn(async () => ({ mode: "ready" as const, snapshot })),
    updateWithSourceSteps: vi.fn(),
    replaceDocument: vi.fn(),
    setPinned: vi.fn(),
    setSort: vi.fn(),
    createTag: vi.fn(),
    renameTag: vi.fn(),
    recolorTag: vi.fn(),
    mergeTag: vi.fn(),
    deleteTag: vi.fn(),
    history: vi.fn(),
    version: vi.fn(),
    restoreVersion: vi.fn(),
    changeTrash: vi.fn(),
    undoTrash: vi.fn(),
    emptyTrash: vi.fn(),
    eraseLegacy: vi.fn(),
  };
  const base: NotesStore = {
    list: vi.fn(async () => [a, b]),
    get: vi.fn(async (id) => (id === "A" ? a : b)),
    create: vi.fn(),
    update: vi.fn(),
    trash: vi.fn(),
    restore: vi.fn(),
    erase: vi.fn(),
    subscribe: () => () => {},
    persistence: () => ({ status: "ready" }),
    close: vi.fn(),
  };
  const owner: NotesLibraryStore = { ...base, library };
  const service: NoteLinkService = {
    admission: vi.fn(async () => ({
      mode: "current" as const,
      token: snapshot.token,
      graph: "ready" as const,
    })),
    currentToken: vi.fn(),
    search: vi.fn(),
    reference: vi.fn(),
    resolve: vi.fn(async (ref) => ({
      status: "available" as const,
      target: ref,
      token: snapshot.token,
      noteRevision: 1,
      title: ref.noteId,
    })),
    outgoing: vi.fn(),
    backlinks: vi.fn(),
    linkedNoteIds: vi.fn(async () => ({
      status: "ready" as const,
      token: snapshot.token,
      items: [],
    })),
    verifyGraph: vi.fn(),
    cancelVerification: vi.fn(),
    prepareRepair: vi.fn(),
    commitRepair: vi.fn(),
    prepareExport: vi.fn(),
    exportFiles: vi.fn(),
    assertFreshExport: vi.fn(),
    subscribe: () => () => {},
    onInvalidate: () => () => {},
    close: vi.fn(),
  };
  model.service = service;
  let navigator: NoteLinkNavigator | null = null;
  const register = vi.fn((value: NoteLinkNavigator | null) => {
    navigator = value;
  });
  const props = {
    store: base,
    library,
    sourceOwner: owner,
    session: {
      accountId: account,
      deviceId: "33333333-3333-4333-8333-333333333333",
      email: "explicit-routing-boundary@example.test",
      deviceState: "trusted" as const,
    },
    onSignOut: vi.fn(async () => {}),
    onNoteLinkNavigatorReady: register,
    onNoteLinkScopeRevoked: vi.fn(),
  };
  const view = render(<Workspace {...props} />);
  return { base, service, register, view, props, nav: () => navigator };
}
function publish(state: SearchState) {
  model.searchState = state;
  model.searchListeners.forEach((fn) => fn());
}
function readySearch(): SearchState {
  return {
    status: "ready",
    raw: "needle",
    handle: Object.freeze({}) as Extract<
      SearchState,
      { status: "ready" }
    >["handle"],
    versions: {
      accountId: account,
      library: snapshot.token,
      collections: { epoch, revision: 1 },
    },
    counts: { all: 1, notes: 1, clips: 0, cards: 0 },
    groups: [
      {
        kind: "note",
        offset: 0,
        previous: null,
        next: null,
        items: [
          {
            locator: target("A"),
            entityRevision: 1,
            primary: { text: "A", matches: [], before: false, after: false },
            secondary: [],
          },
        ],
      },
    ],
    page: null,
  };
}
beforeEach(() => {
  model.noteMounts.clear();
  model.noteUnmounts.clear();
  model.searchState = { status: "idle", raw: "" };
  model.searchListeners.clear();
  model.searchInvalidate = null;
  model.searchService = {
    getSnapshot: () => model.searchState,
    subscribe: () => () => {},
    onInvalidate: () => () => {},
    query: vi.fn(async () => {
      publish(readySearch());
    }),
    continue: vi.fn(),
    page: vi.fn(),
    cancelPage: vi.fn(),
    cancel: vi.fn(() => publish({ status: "idle", raw: "" })),
    close: vi.fn(),
  };
  vi.stubGlobal("matchMedia", () => ({
    matches: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  model.linkBoot = true;
  model.sourceBoot = true;
  model.service = null;
  vi.mocked(buildDownload).mockClear();
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
  URL.createObjectURL = vi.fn(() => "blob:synthetic");
  URL.revokeObjectURL = vi.fn();
});

it("blocks keyboard Search admission while dirty and requires a new explicit command after the guard clears", async () => {
  const f = fixture();
  await screen.findByRole("heading", { name: "All notes" });
  const stop = registerCloseGuard(() => false);
  fireEvent.keyDown(window, { key: "k", ctrlKey: true });
  expect(
    screen.queryByRole("textbox", { name: "Search notes, clips and cards" }),
  ).not.toBeInTheDocument();
  stop();
  await act(async () => {});
  expect(
    screen.queryByRole("textbox", { name: "Search notes, clips and cards" }),
  ).not.toBeInTheDocument();
  fireEvent.keyDown(window, { key: "k", ctrlKey: true });
  expect(
    await screen.findByRole("textbox", {
      name: "Search notes, clips and cards",
    }),
  ).toBeVisible();
  expect(model.searchService!.query).not.toHaveBeenCalled();
  expect(f.base.update).not.toHaveBeenCalled();
});
async function search() {
  fireEvent.click(
    screen.getByRole("button", { name: "Search notes, clips and cards" }),
  );
  const input = await screen.findByRole("textbox", {
    name: "Search notes, clips and cards",
  });
  fireEvent.change(input, { target: { value: "needle" } });
  fireEvent.submit(input.closest("form")!);
  await screen.findByText("1 result for “needle”");
  return input;
}
it("keeps exact clean Notes origin through result and Back/Clear without persisting the query", async () => {
  const f = fixture();
  await screen.findByRole("heading", { name: "All notes" });
  fireEvent.click(screen.getByRole("button", { name: /^B / }));
  await screen.findByRole("heading", { name: "Editor B" });
  const hash = location.hash;
  await search();
  fireEvent.click(
    within(screen.getByRole("region", { name: "Notes results" })).getByRole(
      "button",
    ),
  );
  await screen.findByRole("heading", { name: "Editor A" });
  fireEvent.click(screen.getByRole("button", { name: "Back to search" }));
  await screen.findByText("1 result for “needle”");
  fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
  await screen.findByRole("heading", { name: "Editor B" });
  expect(location.hash).toBe(hash);
  expect(f.base.update).not.toHaveBeenCalled();
});
it("fences a held result resolution when scope is revoked before its late completion", async () => {
  const f = fixture();
  await screen.findByRole("heading", { name: "All notes" });
  await search();
  const pending = held<Awaited<ReturnType<NoteLinkService["resolve"]>>>();
  vi.mocked(f.service.resolve).mockReturnValueOnce(pending.promise);
  fireEvent.click(
    within(screen.getByRole("region", { name: "Notes results" })).getByRole(
      "button",
    ),
  );
  act(() => {
    model.searchInvalidate!("epoch");
    publish({ status: "idle", raw: "" });
  });
  await act(async () => {
    pending.resolve({
      status: "available",
      target: target("A"),
      noteRevision: 1,
      title: "A",
      token: snapshot.token,
    });
  });
  expect(
    screen.queryByRole("heading", { name: "Editor A" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("textbox", { name: "Search notes, clips and cards" }),
  ).not.toBeInTheDocument();
  expect(screen.queryByText(/needle/)).not.toBeInTheDocument();
});
it("keeps changed query text but requires explicit Search again before new counts", async () => {
  fixture();
  await screen.findByRole("heading", { name: "All notes" });
  await search();
  expect(model.searchService!.query).toHaveBeenCalledTimes(1);
  act(() => {
    model.searchInvalidate!("changed");
    publish({ status: "changed", raw: "needle" });
  });
  expect(
    screen.getByRole("textbox", { name: "Search notes, clips and cards" }),
  ).toHaveValue("needle");
  expect(screen.queryByText("1 result for “needle”")).not.toBeInTheDocument();
  expect(model.searchService!.query).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "Search again" }));
  await screen.findByText("1 result for “needle”");
  expect(model.searchService!.query).toHaveBeenCalledTimes(2);
});
it("clears a held raw query and route on privacy invalidation even before the first service query", async () => {
  fixture();
  await screen.findByRole("heading", { name: "All notes" });
  fireEvent.click(
    screen.getByRole("button", { name: "Search notes, clips and cards" }),
  );
  const input = await screen.findByRole("textbox", {
    name: "Search notes, clips and cards",
  });
  fireEvent.change(input, { target: { value: "private pending raw" } });
  act(() => model.searchInvalidate!("unverified"));
  expect(
    screen.queryByRole("textbox", { name: "Search notes, clips and cards" }),
  ).not.toBeInTheDocument();
  fireEvent.click(
    screen.getByRole("button", { name: "Search notes, clips and cards" }),
  );
  expect(
    await screen.findByRole("textbox", {
      name: "Search notes, clips and cards",
    }),
  ).toHaveValue("");
  expect(model.searchService!.query).not.toHaveBeenCalled();
});

it("removes a retained ready certificate before exposing Search while a genuine freshness action is held", async () => {
  fixture();
  await screen.findByRole("heading", { name: "All notes" });
  await search();
  fireEvent.click(
    within(screen.getByRole("region", { name: "Notes results" })).getByRole(
      "button",
    ),
  );
  await screen.findByRole("heading", { name: "Editor A" });
  const proof = held<void>();
  vi.mocked(model.searchService!.query).mockImplementationOnce(async () => {
    publish({ status: "pending", raw: "needle", progress: null });
    await proof.promise;
    publish(readySearch());
  });
  fireEvent.click(screen.getByRole("button", { name: "Back to search" }));
  expect(
    screen.getByText("Searching local notes, clips and cards…"),
  ).toBeVisible();
  expect(screen.queryByText("1 result for “needle”")).not.toBeInTheDocument();
  expect(
    screen.queryByRole("region", { name: "Notes results" }),
  ).not.toBeInTheDocument();
  expect(model.searchService!.query).toHaveBeenCalledTimes(2);
  await act(async () => proof.resolve(undefined));
  await screen.findByText("1 result for “needle”");
});
it("retains changed state on Back instead of silently granting a new matching round", async () => {
  fixture();
  await screen.findByRole("heading", { name: "All notes" });
  await search();
  fireEvent.click(
    within(screen.getByRole("region", { name: "Notes results" })).getByRole(
      "button",
    ),
  );
  await screen.findByRole("heading", { name: "Editor A" });
  act(() => {
    model.searchInvalidate!("changed");
    publish({ status: "changed", raw: "needle" });
  });
  fireEvent.click(screen.getByRole("button", { name: "Back to search" }));
  expect(
    screen.getByRole("heading", { name: "Your library changed" }),
  ).toBeVisible();
  expect(model.searchService!.query).toHaveBeenCalledTimes(1);
});
it("clears query and every held editor when a held reentry proof fails authority, suppressing its late error", async () => {
  fixture();
  await screen.findByRole("heading", { name: "All notes" });
  fireEvent.click(screen.getByRole("button", { name: /^B / }));
  await screen.findByRole("heading", { name: "Editor B" });
  await search();
  fireEvent.click(
    within(screen.getByRole("region", { name: "Notes results" })).getByRole(
      "button",
    ),
  );
  await screen.findByRole("heading", { name: "Editor A" });
  const proof = held<void>();
  vi.mocked(model.searchService!.query).mockImplementationOnce(async () => {
    publish({ status: "pending", raw: "needle", progress: null });
    await proof.promise;
    throw Error("Unverified source");
  });
  fireEvent.click(screen.getByRole("button", { name: "Back to search" }));
  expect(screen.queryByText("1 result for “needle”")).not.toBeInTheDocument();
  await act(async () => {
    model.searchInvalidate!("unverified");
    publish({ status: "idle", raw: "" });
    proof.resolve(undefined);
  });
  expect(
    screen.queryByRole("textbox", { name: "Search notes, clips and cards" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByText("Search couldn’t finish this action. Try again."),
  ).not.toBeInTheDocument();
  expect(model.noteUnmounts.get("A")).toBe(1);
  expect(model.noteUnmounts.get("B")).toBe(1);
});
it("keeps max2 actors at stable keyed positions through origin B to result A and Clear, preserving local state", async () => {
  const f = fixture();
  await screen.findByRole("heading", { name: "All notes" });
  fireEvent.click(screen.getByRole("button", { name: /^B / }));
  const origin = (
    await screen.findByRole("heading", { name: "Editor B" })
  ).closest("section")!;
  fireEvent.click(
    within(origin).getByRole("button", { name: "Advance actor state" }),
  );
  await search();
  fireEvent.click(
    within(screen.getByRole("region", { name: "Notes results" })).getByRole(
      "button",
    ),
  );
  await screen.findByRole("heading", { name: "Editor A" });
  expect(origin.isConnected).toBe(true);
  expect(model.noteMounts.get("B")).toBe(1);
  expect(f.view.container.querySelectorAll(".note-actor")).toHaveLength(2);
  fireEvent.click(screen.getByRole("button", { name: "Back to search" }));
  await screen.findByText("1 result for “needle”");
  fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
  expect(
    (await screen.findByRole("heading", { name: "Editor B" })).closest(
      "section",
    ),
  ).toBe(origin);
  expect(within(origin).getByRole("status")).toHaveTextContent(
    "Actor state B 1",
  );
  expect(model.noteMounts.get("B")).toBe(1);
  expect(model.noteUnmounts.get("B")).toBeUndefined();
  expect(f.view.container.querySelectorAll(".note-actor")).toHaveLength(1);
});

it("freshens a hidden ready certificate on sidebar reentry before exposing any old counts", async () => {
  fixture();
  await screen.findByRole("heading", { name: "All notes" });
  await search();
  fireEvent.click(screen.getByRole("button", { name: /^All notes/ }));
  const proof = held<void>();
  vi.mocked(model.searchService!.query).mockImplementationOnce(async () => {
    publish({ status: "pending", raw: "needle", progress: null });
    await proof.promise;
    publish(readySearch());
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Search notes, clips and cards" }),
  );
  expect(
    screen.getByText("Searching local notes, clips and cards…"),
  ).toBeVisible();
  expect(screen.queryByText("1 result for “needle”")).not.toBeInTheDocument();
  expect(model.searchService!.query).toHaveBeenLastCalledWith(
    "needle",
    undefined,
    { note: 0 },
  );
  await act(async () => proof.resolve(undefined));
  await screen.findByText("1 result for “needle”");
});

it("passes only numeric current page intent into a fresh query, never retained cursors", async () => {
  fixture();
  await screen.findByRole("heading", { name: "All notes" });
  await search();
  const state = readySearch();
  if (state.status !== "ready") throw Error("Expected ready fixture");
  act(() =>
    publish({
      ...state,
      counts: { all: 120, notes: 120, clips: 0, cards: 0 },
      groups: state.groups.map((group) => ({ ...group, offset: 50 })),
    }),
  );
  fireEvent.click(
    within(screen.getByRole("region", { name: "Notes results" })).getByRole(
      "button",
      { name: "A" },
    ),
  );
  await screen.findByRole("heading", { name: "Editor A" });
  fireEvent.click(screen.getByRole("button", { name: "Back to search" }));
  expect(model.searchService!.query).toHaveBeenLastCalledWith(
    "needle",
    undefined,
    { note: 50 },
  );
});
