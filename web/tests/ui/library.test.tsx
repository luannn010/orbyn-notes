import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { Note, NotesStore } from "../../src/domain/contracts";
import type {
  LibraryMutationResult,
  LibrarySnapshot,
  NotesLibrary,
  TrashUndo,
} from "../../src/library/contracts";
import { LibraryConflictError } from "../../src/library/contracts";
import { checkClose } from "../../src/desktop/closeGuard";
import { useLibraryAction } from "../../src/ui/libraryAction";
import { TagsView } from "../../src/ui/TagsView";
import { VersionHistory } from "../../src/ui/VersionHistory";
import { NoteEditor } from "../../src/ui/NoteEditor";
import { Workspace } from "../../src/ui/Workspace";
vi.mock("../../src/ui/RichEditor", () => ({
  RichEditor: ({
    readOnly,
    document,
  }: {
    readOnly: boolean;
    document: unknown;
  }) => (
    <div aria-label="Preview boundary" data-readonly={readOnly}>
      {JSON.stringify(document)}
    </div>
  ),
}));
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
});
afterEach(() => vi.unstubAllGlobals());
const note: Note = {
  id: "note-1",
  title: "A note",
  document: {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [{ type: "text", text: "Current writing" }],
      },
    ],
  },
  tags: ["Trip"],
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-11-11T00:00:00Z",
  trashedAt: null,
  revision: 2,
};
const snapshot: LibrarySnapshot = {
  token: { epoch: "epoch-1", revision: 2 },
  notes: [note],
  tags: [
    {
      id: "tag-1",
      name: "Trip",
      color: "#3b82f6",
      revision: 1,
      createdAt: note.createdAt,
      updatedAt: note.updatedAt,
      state: "active",
      mergedInto: null,
    },
  ],
  metadata: [
    { noteId: note.id, pinned: false, tagIds: ["tag-1"], revision: 1 },
  ],
  preferences: { sort: "edited" },
};
const result: LibraryMutationResult = {
  snapshot,
  note: null,
  tag: null,
  undo: null,
  removedCount: 0,
  replayed: false,
};
function library(overrides: Partial<NotesLibrary> = {}): NotesLibrary {
  return {
    replaceDocument: vi.fn(async () => {
      throw new Error("This fixture has no replacement editor.");
    }),
    updateWithSourceSteps: vi.fn(async () => {
      throw new Error("This fixture has no source-aware editor.");
    }),
    read: vi.fn(async () => ({ mode: "ready" as const, snapshot })),
    setPinned: vi.fn(async () => result),
    setSort: vi.fn(async () => result),
    createTag: vi.fn(async () => result),
    renameTag: vi.fn(async () => result),
    recolorTag: vi.fn(async () => result),
    mergeTag: vi.fn(async () => result),
    deleteTag: vi.fn(async () => result),
    history: vi.fn(async () => []),
    version: vi.fn(async () => null),
    restoreVersion: vi.fn(async () => result),
    changeTrash: vi.fn(async () => result),
    undoTrash: vi.fn(async () => result),
    emptyTrash: vi.fn(async () => result),
    eraseLegacy: vi.fn(async () => result),
    ...overrides,
  };
}
function store(): NotesStore {
  return {
    list: vi.fn(async () => [note]),
    get: vi.fn(async () => note),
    create: vi.fn(),
    update: vi.fn(),
    trash: vi.fn(),
    restore: vi.fn(),
    erase: vi.fn(),
    subscribe: () => () => {},
    persistence: vi.fn(),
    close: vi.fn(),
  };
}
function workspace(api: NotesLibrary) {
  return render(
    <Workspace
      library={api}
      store={store()}
      session={{
        accountId: "synthetic",
        deviceId: "synthetic",
        deviceState: "trusted",
        email: "library-fixture@example.test",
      }}
      onSignOut={vi.fn()}
    />,
  );
}
describe("library mutation recovery", () => {
  it("reuses an immutable operation ID only after explicit reload", async () => {
    const effect = vi
        .fn()
        .mockRejectedValueOnce(new Error("Result unknown"))
        .mockResolvedValue(result),
      done = vi.fn();
    const { result: hook } = renderHook(() => useLibraryAction("epoch-1"));
    act(() => hook.current.start(effect, done));
    await waitFor(() => expect(hook.current.error).toBe("Result unknown"));
    expect(checkClose()).toBe("draft");
    act(() => hook.current.retry());
    expect(effect).toHaveBeenCalledTimes(1);
    await act(() => hook.current.reload(async () => snapshot));
    act(() => hook.current.retry());
    await waitFor(() => expect(done).toHaveBeenCalledTimes(1));
    expect(effect.mock.calls[1]?.[0]).toBe(effect.mock.calls[0]?.[0]);
    expect(checkClose()).toBe("allowed");
  });
  it("never retries a CAS conflict on a newer snapshot", async () => {
    const effect = vi
      .fn()
      .mockRejectedValue(new LibraryConflictError(snapshot));
    const { result: hook } = renderHook(() => useLibraryAction());
    act(() => hook.current.start(effect, vi.fn()));
    await waitFor(() => expect(hook.current.conflict).toBe(true));
    await act(() => hook.current.reload(async () => snapshot));
    act(() => hook.current.retry());
    expect(effect).toHaveBeenCalledTimes(1);
    act(() => hook.current.dismiss());
    expect(checkClose()).toBe("allowed");
  });
  it("fences a response from the erased epoch", async () => {
    let finish!: (value: LibraryMutationResult) => void;
    const pending = new Promise<LibraryMutationResult>((yes) => {
        finish = yes;
      }),
      done = vi.fn();
    const view = renderHook(({ epoch }) => useLibraryAction(epoch), {
      initialProps: { epoch: "old" },
    });
    act(() => view.result.current.start(() => pending, done));
    view.rerender({ epoch: "replacement" });
    await act(async () => finish(result));
    expect(done).not.toHaveBeenCalled();
    expect(checkClose()).toBe("allowed");
  });
});
it("keeps a failed New tag form guarded and retries the same creation", async () => {
  const createTag = vi
    .fn()
    .mockRejectedValueOnce(new Error("Quota unavailable"))
    .mockResolvedValue(result);
  render(
    <TagsView
      library={library({ createTag })}
      snapshot={snapshot}
      onResult={vi.fn()}
      reload={async () => snapshot}
      onOpenTag={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByText("New tag"));
  const dialog = screen.getByRole("dialog");
  fireEvent.change(within(dialog).getByLabelText("Name"), {
    target: { value: "New tag draft" },
  });
  expect(checkClose()).toBe("draft");
  fireEvent.click(within(dialog).getByText("Create tag"));
  await within(dialog).findByText("Quota unavailable");
  expect(within(dialog).getByLabelText("Name")).toHaveValue("New tag draft");
  fireEvent.click(within(dialog).getByText("Reload saved library"));
  await waitFor(() =>
    expect(within(dialog).getByText("Retry same action")).toBeEnabled(),
  );
  fireEvent.click(within(dialog).getByText("Retry same action"));
  await waitFor(() => expect(createTag).toHaveBeenCalledTimes(2));
  expect(createTag.mock.calls[1]).toEqual(createTag.mock.calls[0]);
});
it("previews captured tags read-only and confirms title/document-only restore", async () => {
  const version = {
    id: "v1",
    noteId: note.id,
    noteRevision: 1,
    capturedAt: "2026-11-10T10:00:00Z",
    reason: "edit" as const,
    title: "Old title",
    document: {
      type: "doc" as const,
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Old writing" }] },
      ],
    },
    tagsAtCapture: [
      { id: "old-tag", name: "Deleted historical tag", color: null },
    ],
  };
  const api = library({ history: vi.fn(async () => [version]) });
  render(
    <VersionHistory
      note={note}
      library={api}
      onClose={vi.fn()}
      onResult={vi.fn()}
      reload={async () => snapshot}
    />,
  );
  fireEvent.click(await screen.findByRole("button", { name: /Previous edit/ }));
  expect(screen.getByText("Deleted historical tag")).toBeInTheDocument();
  expect(screen.getByLabelText("Preview boundary")).toHaveAttribute(
    "data-readonly",
    "true",
  );
  fireEvent.click(screen.getByText("Restore this version"));
  expect(api.restoreVersion).not.toHaveBeenCalled();
  const confirm = screen.getByRole("dialog", { name: "Restore this version?" });
  expect(
    within(confirm).getByText(/Current tags and pin stay unchanged/),
  ).toBeInTheDocument();
  fireEvent.click(within(confirm).getByText("Restore version"));
  await waitFor(() =>
    expect(api.restoreVersion).toHaveBeenCalledWith(
      note.id,
      "v1",
      2,
      expect.any(String),
    ),
  );
});
it("uses semantic Undo for restoring Trash, retaining the original trash clock", async () => {
  const trashed = { ...note, trashedAt: "2026-11-01T10:00:00Z" };
  const receipt: TrashUndo = {
    epoch: "epoch-1",
    operationId: "original",
    noteId: note.id,
    resultRevision: 3,
    previousTrashedAt: trashed.trashedAt,
    resultTrashedAt: null,
    expiresAt: new Date(Date.now() + 5000).toISOString(),
  };
  const api = library({
    read: vi.fn(async () => ({
      mode: "ready" as const,
      snapshot: { ...snapshot, notes: [trashed] },
    })),
    changeTrash: vi.fn(async () => ({ ...result, note, undo: receipt })),
  });
  workspace(api);
  fireEvent.click(await screen.findByRole("button", { name: /Trash1/ }));
  fireEvent.click(screen.getByText("Restore"));
  await screen.findByText("Note restored");
  fireEvent.click(screen.getByText("Undo"));
  await waitFor(() =>
    expect(api.undoTrash).toHaveBeenCalledWith(receipt, expect.any(String)),
  );
  expect(api.changeTrash).toHaveBeenCalledWith(
    note.id,
    "restore",
    2,
    expect.any(String),
  );
});
it("requires explicit Empty Trash confirmation and reports the actual removed count", async () => {
  const trashed = { ...note, trashedAt: "2026-11-01T10:00:00Z" };
  const api = library({
    read: vi.fn(async () => ({
      mode: "ready" as const,
      snapshot: { ...snapshot, notes: [trashed] },
    })),
    emptyTrash: vi.fn(async () => ({ ...result, removedCount: 1 })),
  });
  workspace(api);
  fireEvent.click(await screen.findByRole("button", { name: /Trash1/ }));
  fireEvent.click(screen.getByText("Empty Trash"));
  expect(api.emptyTrash).not.toHaveBeenCalled();
  fireEvent.click(
    within(screen.getByRole("dialog", { name: "Empty Trash?" })).getByText(
      "Empty Trash",
    ),
  );
  await screen.findByText("Removed 1 notes permanently");
  expect(api.emptyTrash).toHaveBeenCalledWith(
    snapshot.token,
    expect.any(String),
  );
});
it("keeps legacy read/export available but rejects editing without a fabricated token", async () => {
  const api = library({
    read: vi.fn(async () => ({
      mode: "legacy-read-only" as const,
      notes: [note],
      reason: "metadata-limit" as const,
      recovery: {
        kind: "export-or-confirm-erase" as const,
        deviceGeneration: 47,
      },
    })),
  });
  workspace(api);
  await screen.findByText(/Library metadata exceeds/);
  expect(screen.getByText("New note")).toBeDisabled();
  expect(screen.getByText("Manage tags")).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: /A note/ }));
  expect(screen.getByLabelText("Note title")).toHaveAttribute("readonly");
  fireEvent.click(screen.getByRole("button", { name: "Note menu" }));
  expect(screen.getByRole("menuitem", { name: /Duplicate/ })).toBeDisabled();
  expect(
    screen.getByRole("menuitem", { name: /Export Markdown/ }),
  ).toBeEnabled();
  expect(api.setPinned).not.toHaveBeenCalled();
});

it("persists the chosen sort and maps Pinned to real metadata", async () => {
  const pinned = {
    ...snapshot,
    metadata: [{ ...snapshot.metadata[0]!, pinned: true }],
  };
  const api = library({
    setPinned: vi.fn(async () => ({ ...result, snapshot: pinned })),
    setSort: vi.fn(async () => ({
      ...result,
      snapshot: { ...pinned, preferences: { sort: "title" as const } },
    })),
  });
  workspace(api);
  await screen.findByRole("heading", { name: "All notes" });
  fireEvent.click(screen.getByRole("button", { name: "Pin A note" }));
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Unpin A note" }),
    ).toHaveAttribute("aria-pressed", "true"),
  );
  fireEvent.click(screen.getByRole("button", { name: /^Pinned/ }));
  expect(screen.getByRole("heading", { name: "Pinned" })).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Sort notes"), {
    target: { value: "title" },
  });
  await waitFor(() =>
    expect(api.setSort).toHaveBeenCalledWith(
      "title",
      snapshot.token,
      expect.any(String),
    ),
  );
});
it("passes the actual read-only generation only after typed erase confirmation", async () => {
  const api = library({
    read: vi.fn(async () => ({
      mode: "legacy-read-only" as const,
      notes: [note],
      reason: "metadata-limit" as const,
      recovery: {
        kind: "export-or-confirm-erase" as const,
        deviceGeneration: 47,
      },
    })),
  });
  workspace(api);
  await screen.findByText(/Library metadata exceeds/);
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  fireEvent.click(screen.getByRole("button", { name: /Data/ }));
  fireEvent.click(screen.getByRole("button", { name: "Erase this browser" }));
  const dialog = screen.getByRole("dialog", {
    name: "Erase notes from this browser?",
  });
  expect(api.eraseLegacy).not.toHaveBeenCalled();
  fireEvent.change(within(dialog).getByLabelText("Type ERASE to confirm"), {
    target: { value: "ERASE" },
  });
  fireEvent.click(within(dialog).getByRole("button", { name: "Erase notes" }));
  await waitFor(() =>
    expect(api.eraseLegacy).toHaveBeenCalledWith(
      { deviceGeneration: 47, confirmation: "ERASE" },
      expect.any(String),
    ),
  );
});

it.each(["ready", "legacy-read-only"] as const)(
  "names the complete irreversible erase scope and export exclusions in %s mode",
  async (mode) => {
    const api = library(
      mode === "ready"
        ? {}
        : {
            read: vi.fn(async () => ({
              mode: "legacy-read-only" as const,
              notes: [note],
              reason: "metadata-limit" as const,
              recovery: {
                kind: "export-or-confirm-erase" as const,
                deviceGeneration: 47,
              },
            })),
          },
    );
    workspace(api);
    await screen.findByRole("heading", { name: "All notes" });
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(screen.getByRole("button", { name: "Data and export" }));
    fireEvent.click(screen.getByRole("button", { name: "Erase this browser" }));
    const dialog = screen.getByRole("dialog", {
      name: "Erase notes from this browser?",
    });
    expect(dialog).toHaveTextContent("tags, pins and version history");
    expect(dialog).toHaveTextContent("Study decks, cards and reviews");
    expect(dialog).toHaveTextContent(
      "protected Journal entries, habits and recovery drafts",
    );
    expect(dialog).toHaveTextContent("Your account stays signed in");
    expect(dialog).toHaveTextContent(
      "Notes Markdown export does not include Study, Journal, Clips, tag colors, pins or version history",
    );
    expect(
      within(dialog).getByRole("button", { name: "Open Journal to export" }),
    ).toBeEnabled();
    expect(
      within(dialog).getByRole("button", { name: "Erase notes" }),
    ).toBeDisabled();
    expect(api.eraseLegacy).not.toHaveBeenCalled();
  },
);
it("preserves exact comma/case/Unicode tags while adding, saving and reopening", async () => {
  const initial = { ...note, tags: ["Trip", "trip", "café", "cafe\u0301"] };
  let saved = initial;
  const update = vi
    .fn<NotesStore["update"]>()
    .mockImplementation(async (_id, patch, revision) => {
      saved = { ...saved, ...patch, revision: revision + 1 };
      return saved;
    });
  const catalog = [
    { ...snapshot.tags[0]!, id: "comma-tag", name: "work, play" },
  ];
  const props = {
    store: { ...store(), update },
    onSaved: vi.fn(),
    onBack: vi.fn(),
    onTrash: vi.fn(),
    onExport: vi.fn(),
    tagCatalog: catalog,
  };
  const view = render(<NoteEditor note={initial} {...props} />);
  fireEvent.change(screen.getByLabelText("Add existing tag"), {
    target: { value: "comma-tag" },
  });
  fireEvent.change(screen.getByLabelText("New tag"), {
    target: { value: "Another tag" },
  });
  expect(checkClose()).toBe("draft");
  fireEvent.click(screen.getByRole("button", { name: "Add tag" }));
  await waitFor(() =>
    expect(saved.tags).toEqual([...initial.tags, "work, play", "Another tag"]),
  );
  view.unmount();
  render(<NoteEditor note={saved} {...props} />);
  for (const name of [...initial.tags, "work, play", "Another tag"])
    expect(
      screen.getByRole("button", { name: `Remove tag ${name}` }),
    ).toBeInTheDocument();
  fireEvent.click(
    screen.getByRole("button", { name: "Remove tag Another tag" }),
  );
  await waitFor(() =>
    expect(saved.tags).toEqual([...initial.tags, "work, play"]),
  );
});

it("keeps an unsubmitted single tag guarded without rewriting saved tags", async () => {
  const update = vi.fn();
  const back = vi.fn();
  render(
    <NoteEditor
      note={{ ...note, tags: ["work, play"] }}
      store={{ ...store(), update }}
      onSaved={vi.fn()}
      onBack={back}
      onTrash={vi.fn()}
      onExport={vi.fn()}
    />,
  );
  fireEvent.change(screen.getByLabelText("New tag"), {
    target: { value: "Unsubmitted" },
  });
  expect(checkClose()).toBe("draft");
  fireEvent.click(screen.getByRole("button", { name: "← Back to notes" }));
  expect(back).not.toHaveBeenCalled();
  expect(screen.getByLabelText("New tag")).toHaveValue("Unsubmitted");
  expect(update).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("Clear tag input"));
  expect(checkClose()).toBe("allowed");
  expect(
    screen.getByRole("button", { name: "Remove tag work, play" }),
  ).toBeInTheDocument();
});
it("ignores old reload completion after replacement or cleared action", async () => {
  let finish!: () => void;
  const pending = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const effect = vi.fn().mockRejectedValue(new Error("Unknown result"));
  const view = renderHook(({ scope }) => useLibraryAction(scope), {
    initialProps: { scope: "old" },
  });
  act(() => view.result.current.start(effect, vi.fn()));
  await waitFor(() => expect(view.result.current.error).toBe("Unknown result"));
  let reload!: Promise<void>;
  act(() => {
    reload = view.result.current.reload(() => pending);
  });
  view.rerender({ scope: "new" });
  await act(async () => {
    finish();
    await reload;
  });
  expect(view.result.current.reloaded).toBe(false);
  expect(view.result.current.error).toBe("");
});
