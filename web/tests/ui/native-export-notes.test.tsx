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
vi.mock("../../src/desktop/window", () => ({ isDesktop: () => true }));
const native = vi.hoisted(() => ({ save: vi.fn() }));
vi.mock("../../src/desktop/files", () => ({ saveDesktopFile: native.save }));
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

afterEach(() => vi.unstubAllGlobals());
async function openExport() {
  const f = fixture();
  await waitFor(() => expect(f.nav()).toBeTypeOf("function"));
  fireEvent.click(screen.getByRole("button", { name: /^A / }));
  vi.mocked(f.service.prepareExport).mockResolvedValue({} as NoteExportIntent);
  vi.mocked(f.service.exportFiles).mockResolvedValue({ token: snapshot.token, files: [{ filename: "A.md", content: "Synthetic note" }], warnings: [] });
  vi.mocked(f.service.assertFreshExport).mockResolvedValue(undefined);
  fireEvent.click(screen.getByRole("button", { name: "Export this note" }));
  const dialog = screen.getByRole("dialog", { name: "Export Markdown" });
  fireEvent.click(within(dialog).getByRole("button", { name: "Export" }));
  await waitFor(() => expect(native.save).toHaveBeenCalledOnce());
  return { f, dialog };
}
beforeEach(() => { native.save.mockReset(); });
it("does not report a cancelled Notes save", async () => {
  native.save.mockResolvedValue(false);
  const { dialog } = await openExport();
  await waitFor(() => expect(within(dialog).getByRole("button", { name: "Export" })).toBeEnabled());
  expect(screen.queryByText("Export saved")).not.toBeInTheDocument();
});
it("rechecks note freshness before the native write", async () => {
  let release!: () => void;
  const write = vi.fn();
  native.save.mockImplementation(async (_name, _blob, beforeWrite) => {
    await new Promise<void>((resolve) => { release = resolve; });
    await beforeWrite();
    write();
    return true;
  });
  const { f } = await openExport();
  vi.mocked(f.service.assertFreshExport).mockRejectedValueOnce(new Error("changed"));
  await act(async () => { release(); });
  expect(write).not.toHaveBeenCalled();
  expect(await screen.findByText("Couldn’t export notes. Your notes were not changed.")).toBeVisible();
});
