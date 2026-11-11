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
import { Workspace } from "../../src/ui/Workspace";
import { registerCloseGuard } from "../../src/desktop/closeGuard";
import type { NoteExportIntent } from "../../src/links/contracts";
import { buildDownload } from "../../src/ui/download";
const model = vi.hoisted(() => ({
  service: null as NoteLinkService | null,
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
vi.mock("../../src/ui/download", () => ({
  buildDownload: vi.fn(() => ({
    blob: new Blob(["legacy"]),
    name: "legacy.md",
  })),
}));
vi.mock("../../src/ui/NoteEditor", () => ({
  NoteEditor: (
    props: Parameters<typeof import("../../src/ui/NoteEditor").NoteEditor>[0],
  ) => (
    <section>
      <h2>Editor {props.note.title}</h2>
      <div role="textbox" aria-label="Note content" tabIndex={0} />
      <button onClick={() => props.onExport(props.note)}>
        Export this note
      </button>
    </section>
  ),
}));
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
beforeEach(() => {
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
it("registers the first navigator only after actual initial boot boundaries settle, without retrying or revoking on later work", async () => {
  model.linkBoot = false;
  model.sourceBoot = false;
  const f = fixture();
  await screen.findByRole("heading", { name: "All notes" });
  expect(f.nav()).toBeNull();
  model.linkBoot = true;
  f.view.rerender(<Workspace {...f.props} />);
  expect(f.nav()).toBeNull();
  model.sourceBoot = true;
  f.view.rerender(<Workspace {...f.props} />);
  await waitFor(() => expect(f.nav()).toBeTypeOf("function"));
  const count = f.register.mock.calls.length;
  model.linkBoot = false;
  model.sourceBoot = false;
  f.view.rerender(<Workspace {...f.props} />);
  expect(f.register).toHaveBeenCalledTimes(count);
  expect(f.service.resolve).not.toHaveBeenCalled();
});
it("forwards and obeys cancellation before work and after held resolve", async () => {
  const f = fixture();
  await waitFor(() => expect(f.nav()).toBeTypeOf("function"));
  const first = new AbortController();
  first.abort();
  expect(await f.nav()!(target("B"), first.signal)).toEqual({
    status: "unavailable",
  });
  expect(f.service.resolve).not.toHaveBeenCalled();
  const delayed = held<Awaited<ReturnType<NoteLinkService["resolve"]>>>();
  vi.mocked(f.service.resolve).mockReturnValueOnce(delayed.promise);
  const controller = new AbortController();
  let result!: ReturnType<NoteLinkNavigator>;
  act(() => {
    result = f.nav()!(target("B"), controller.signal);
  });
  controller.abort();
  await act(async () => {
    delayed.resolve({
      status: "available",
      target: target("B"),
      token: snapshot.token,
      noteRevision: 1,
      title: "B",
    });
    await result;
  });
  expect(f.base.get).not.toHaveBeenCalled();
  expect(
    screen.queryByRole("heading", { name: "Editor B" }),
  ).not.toBeInTheDocument();
});
it("does not admit a selected note after cancellation during held get", async () => {
  const f = fixture();
  await waitFor(() => expect(f.nav()).toBeTypeOf("function"));
  const delayed = held<Note | null>();
  vi.mocked(f.base.get).mockReturnValueOnce(delayed.promise);
  const controller = new AbortController();
  let result!: ReturnType<NoteLinkNavigator>;
  act(() => {
    result = f.nav()!(target("B"), controller.signal);
  });
  await waitFor(() => expect(f.base.get).toHaveBeenCalledWith("B"));
  controller.abort();
  await act(async () => {
    delayed.resolve(b);
    await result;
  });
  expect(await result).toEqual({ status: "unavailable" });
  expect(
    screen.queryByRole("heading", { name: "Editor B" }),
  ).not.toBeInTheDocument();
});
it("never falls back to the legacy renderer when a genuine owner is present but its link facade is not ready", async () => {
  const f = fixture();
  model.service = null;
  f.view.rerender(<Workspace {...f.props} />);
  fireEvent.click(await screen.findByRole("button", { name: /^A / }));
  fireEvent.click(screen.getByRole("button", { name: "Export this note" }));
  fireEvent.click(
    within(screen.getByRole("dialog", { name: "Export Markdown" })).getByRole(
      "button",
      { name: "Export" },
    ),
  );
  await screen.findByText(
    "Note links aren’t ready. Wait for them to open, then try exporting again.",
  );
  expect(buildDownload).not.toHaveBeenCalled();
  expect(screen.getByRole("dialog", { name: "Export Markdown" })).toBeVisible();
});

afterEach(() => vi.unstubAllGlobals());

it("clears its prior navigation guard notice after explicit allowed retry", async () => {
  const f = fixture();
  await waitFor(() => expect(f.nav()).toBeTypeOf("function"));
  const stop = registerCloseGuard(() => false);
  let blocked;
  try {
    await act(async () => {
      blocked = await f.nav()!(target("B"));
    });
    expect(blocked).toEqual({ status: "blocked" });
    await screen.findByText(
      "Finish or discard your unsaved changes before leaving.",
    );
  } finally {
    stop();
  }
  await act(async () => {
    await f.nav()!(target("B"));
  });
  await screen.findByRole("heading", { name: "Editor B" });
  expect(
    screen.queryByText(
      "Finish or discard your unsaved changes before leaving.",
    ),
  ).not.toBeInTheDocument();
});
it("preserves an unrelated prepared-export notice when a later navigation clears its guard ownership", async () => {
  const f = fixture();
  await waitFor(() => expect(f.nav()).toBeTypeOf("function"));
  const stop = registerCloseGuard(() => false);
  try {
    await act(async () => {
      await f.nav()!(target("B"));
    });
  } finally {
    stop();
  }
  fireEvent.click(screen.getByRole("button", { name: /^A / }));
  vi.mocked(f.service.prepareExport).mockResolvedValue({} as NoteExportIntent);
  vi.mocked(f.service.exportFiles).mockResolvedValue({
    token: snapshot.token,
    files: [{ filename: "A.md", content: "Approved boundary fixture" }],
    warnings: [],
  });
  vi.mocked(f.service.assertFreshExport).mockResolvedValue(undefined);
  fireEvent.click(screen.getByRole("button", { name: "Export this note" }));
  fireEvent.click(
    within(screen.getByRole("dialog", { name: "Export Markdown" })).getByRole(
      "button",
      { name: "Export" },
    ),
  );
  await screen.findByText("Export prepared");
  await act(async () => {
    await f.nav()!(target("B"));
  });
  await screen.findByRole("heading", { name: "Editor B" });
  expect(screen.getByText("Export prepared")).toBeVisible();
});

it.each(["epoch", "closed"] as const)(
  "notifies external scope retirement synchronously before clearing %s projections",
  async (reason) => {
    const f = fixture();
    fireEvent.click(await screen.findByRole("button", { name: /^A / }));
    await screen.findByRole("heading", { name: "Editor A" });
    const order: string[] = [];
    f.props.onNoteLinkScopeRevoked.mockImplementation(() => {
      order.push(
        screen.queryByRole("heading", { name: "Editor A" })
          ? "retired-before-clear"
          : "too-late",
      );
    });
    expect(f.props.onNoteLinkScopeRevoked).not.toHaveBeenCalled();
    model.service = null;
    act(() => model.invalidate!(reason));
    expect(f.props.onNoteLinkScopeRevoked).toHaveBeenCalledTimes(1);
    expect(order).toEqual(["retired-before-clear"]);
    expect(
      screen.queryByRole("heading", { name: "Editor A" }),
    ).not.toBeInTheDocument();
  },
);
it("does not retire scope for initial service-null or pending boot registration", async () => {
  model.linkBoot = false;
  model.sourceBoot = false;
  const f = fixture();
  model.service = null;
  f.view.rerender(<Workspace {...f.props} />);
  await screen.findByRole("heading", { name: "All notes" });
  expect(f.nav()).toBeNull();
  expect(f.props.onNoteLinkScopeRevoked).not.toHaveBeenCalled();
});
