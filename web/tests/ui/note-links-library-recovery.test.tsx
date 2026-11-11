import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { TagsView } from "../../src/ui/TagsView";
import { VersionHistory } from "../../src/ui/VersionHistory";
import type {
  NotesLibrary,
  LibrarySnapshot,
  NoteVersion,
} from "../../src/library/contracts";
import type { Note } from "../../src/domain/contracts";
import type { NoteLinkService, NoteTarget } from "../../src/links/contracts";
const target: NoteTarget = {
  kind: "note",
  accountId: "11111111-1111-4111-8111-111111111111",
  libraryEpoch: "22222222-2222-4222-8222-222222222222",
  noteId: "exact-target",
};
const note: Note = {
  id: "source",
  revision: 2,
  title: "Source",
  tags: [],
  createdAt: "2026-11-11T00:00:00Z",
  updatedAt: "2026-11-11T00:00:00Z",
  trashedAt: null,
  document: {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [{ type: "noteLink", attrs: { version: 1, target } }],
      },
    ],
  },
};
const version: NoteVersion = {
  id: "version-1",
  noteId: note.id,
  noteRevision: 1,
  capturedAt: note.createdAt,
  reason: "edit",
  title: "Previous source",
  document: note.document,
  tagsAtCapture: [],
};
const snapshot: LibrarySnapshot = {
  token: { epoch: target.libraryEpoch, revision: 2 },
  notes: [note],
  tags: [],
  metadata: [],
  preferences: { sort: "edited" },
};
function library(): NotesLibrary {
  return {
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
    history: vi.fn(async () => [version]),
    version: vi.fn(),
    restoreVersion: vi.fn(),
    changeTrash: vi.fn(),
    undoTrash: vi.fn(),
    emptyTrash: vi.fn(),
    eraseLegacy: vi.fn(),
  };
}
function service(): NoteLinkService {
  return {
    admission: vi.fn(async () => ({
      mode: "current" as const,
      token: snapshot.token,
      graph: "ready" as const,
    })),
    currentToken: vi.fn(),
    search: vi.fn(),
    reference: vi.fn(),
    resolve: vi.fn(async () => ({
      status: "available" as const,
      target,
      token: snapshot.token,
      title: "Current authorized target",
      noteRevision: 4,
    })),
    outgoing: vi.fn(),
    backlinks: vi.fn(),
    linkedNoteIds: vi.fn(),
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
}
beforeEach(() => {
  window.scrollBy = vi.fn();
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
  Object.defineProperty(Range.prototype, "getClientRects", {
    configurable: true,
    value: () => [],
  });
  Object.defineProperty(Range.prototype, "getBoundingClientRect", {
    configurable: true,
    value: () => new DOMRect(1, 1, 1, 16),
  });
});
it("keeps an open tag draft copyable and disables both UI and handler mutations during index recovery", () => {
  const api = library(),
    props = {
      library: api,
      snapshot,
      onResult: vi.fn(),
      reload: vi.fn(async () => {}),
      onOpenTag: vi.fn(),
    };
  const view = render(<TagsView {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "New tag" }));
  const name = screen.getByRole("textbox", { name: "Name" });
  fireEvent.change(name, { target: { value: "Unsubmitted exact name" } });
  view.rerender(<TagsView {...props} readOnly />);
  expect(name).toHaveAttribute("readonly");
  expect(name).toHaveValue("Unsubmitted exact name");
  fireEvent.change(name, { target: { value: "Must not replace draft" } });
  expect(name).toHaveValue("Unsubmitted exact name");
  expect(screen.getByRole("button", { name: "Create tag" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Create tag" }));
  expect(api.createTag).not.toHaveBeenCalled();
  fireEvent.click(
    within(screen.getByRole("dialog", { name: "New tag" })).getByRole(
      "button",
      { name: "Cancel" },
    ),
  );
  fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
  expect(name).toHaveValue("Unsubmitted exact name");
  view.rerender(<TagsView {...props} />);
  expect(screen.getByRole("button", { name: "Create tag" })).toBeEnabled();
});
it("keeps an already-open history confirmation and typed Notes preview while forbidding restore after admission changes", async () => {
  const api = library(),
    links = service(),
    props = {
      note,
      library: api,
      onClose: vi.fn(),
      onResult: vi.fn(),
      reload: vi.fn(async () => {}),
      noteLinks: { service: links, noteId: note.id, onOpen: vi.fn() },
    };
  const view = render(<VersionHistory {...props} />);
  await screen.findByRole("button", {
    name: "Note reference: Current authorized target",
  });
  expect(
    screen.getByRole("button", {
      name: "Note reference: Current authorized target",
    }),
  ).toBeDisabled();
  expect(
    screen.queryByText(/This content isn’t supported/),
  ).not.toBeInTheDocument();
  fireEvent.click(await screen.findByRole("button", { name: /Previous edit/ }));
  fireEvent.click(
    await screen.findByRole("button", {
      name: "Restore this version",
    }),
  );
  await screen.findByRole("dialog", { name: "Restore this version?" });
  view.rerender(<VersionHistory {...props} readOnly />);
  const restore = within(
    screen.getByRole("dialog", { name: "Restore this version?" }),
  ).getByRole("button", { name: "Restore version" });
  expect(restore).toBeDisabled();
  fireEvent.click(restore);
  expect(api.restoreVersion).not.toHaveBeenCalled();
  fireEvent.click(
    within(
      screen.getByRole("dialog", { name: "Restore this version?" }),
    ).getByRole("button", { name: "Cancel" }),
  );
  expect(
    screen.getByRole("heading", { name: "Previous source" }),
  ).toBeVisible();
  await waitFor(() =>
    expect(
      screen.getByRole("button", {
        name: "Note reference: Current authorized target",
      }),
    ).toBeDisabled(),
  );
  expect(props.noteLinks.onOpen).not.toHaveBeenCalled();
});
