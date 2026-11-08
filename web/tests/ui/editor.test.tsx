import {
  fireEvent,
  render,
  screen,
  waitFor,
  act,
} from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import type { Note, NotesStore } from "../../src/domain/contracts";
import { RevisionConflictError } from "../../src/domain/contracts";
import { NoteEditor } from "../../src/ui/NoteEditor";
vi.mock("../../src/ui/RichEditor", () => ({
  RichEditor: () => <div>Rich editor test boundary</div>,
}));
const initial: Note = {
  id: "n1",
  title: "Initial",
  document: { type: "doc", content: [{ type: "paragraph" }] },
  tags: [],
  createdAt: "2026-01-01",
  updatedAt: "2026-01-01",
  revision: 1,
  trashedAt: null,
};
function setup(update: NotesStore["update"]) {
  const store = {
    update,
    create: vi.fn(),
    trash: vi.fn(),
    restore: vi.fn(),
    list: vi.fn(),
    get: vi.fn(),
    erase: vi.fn(),
    subscribe: vi.fn(),
    persistence: vi.fn(),
    close: vi.fn(),
  } as NotesStore;
  const back = vi.fn();
  render(
    <NoteEditor
      note={initial}
      store={store}
      onSaved={vi.fn()}
      onBack={back}
      onTrash={vi.fn()}
      onExport={vi.fn()}
    />,
  );
  return { store, back };
}
describe("draft durability", () => {
  it("retains the draft and blocks leaving after failed persistence", async () => {
    const update = vi.fn().mockRejectedValue(new Error("Storage denied"));
    const { back } = setup(update);
    fireEvent.change(screen.getByLabelText("Note title"), {
      target: { value: "Keep this draft" },
    });
    await screen.findByText("Storage denied");
    expect(screen.getByLabelText("Note title")).toHaveValue("Keep this draft");
    fireEvent.click(screen.getByText("← Back to notes"));
    expect(back).not.toHaveBeenCalled();
    expect(screen.getByText("Copy text")).toBeVisible();
  });
  it("never replaces a newer draft with an older completed save", async () => {
    let complete!: (n: Note) => void;
    const update = vi
      .fn()
      .mockImplementationOnce(() => new Promise<Note>((r) => (complete = r)))
      .mockImplementation(async (_id, patch, revision) => ({
        ...initial,
        ...patch,
        revision: revision + 1,
      }));
    setup(update);
    fireEvent.change(screen.getByLabelText("Note title"), {
      target: { value: "First" },
    });
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByLabelText("Note title"), {
      target: { value: "Newest" },
    });
    await act(async () =>
      complete({ ...initial, title: "First", revision: 2 }),
    );
    expect(screen.getByLabelText("Note title")).toHaveValue("Newest");
    await waitFor(() => expect(update).toHaveBeenCalledTimes(2));
    expect(update.mock.calls[1]?.[2]).toBe(2);
    await screen.findByText("Saved in this browser");
  });
  it("offers a copy on revision conflicts instead of overwriting", async () => {
    const update = vi
      .fn()
      .mockRejectedValue(
        new RevisionConflictError(
          { ...initial, title: "Other tab", revision: 2 },
          { ...initial, title: "Mine" },
        ),
      );
    setup(update);
    fireEvent.change(screen.getByLabelText("Note title"), {
      target: { value: "Mine" },
    });
    await screen.findByText("Save draft as a copy");
    expect(screen.getByLabelText("Note title")).toHaveValue("Mine");
    expect(update).toHaveBeenCalledTimes(1);
  });
});

// Integration review regressions: navigation and recovery must not discard drafts.
it("continues autosave after immediate Back without inventing a save failure", async () => {
  const update = vi.fn().mockImplementation(async (_id, patch) => ({
    ...initial,
    ...patch,
    revision: 2,
  }));
  const { back } = setup(update);
  fireEvent.change(screen.getByLabelText("Note title"), {
    target: { value: "Save before leaving" },
  });
  fireEvent.click(screen.getByText("← Back to notes"));
  expect(back).not.toHaveBeenCalled();
  expect(screen.queryByText("Couldn’t save")).not.toBeInTheDocument();
  await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
  await screen.findByText("Saved in this browser");
  expect(screen.queryByText("Couldn’t save")).not.toBeInTheDocument();
});
it("requires confirmation and supports Cancel before discarding an unsaved conflict draft", async () => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
  const update = vi
    .fn()
    .mockRejectedValue(
      new RevisionConflictError(
        { ...initial, title: "Saved elsewhere", revision: 2 },
        { ...initial, title: "Mine" },
      ),
    );
  const { back } = setup(update);
  fireEvent.change(screen.getByLabelText("Note title"), {
    target: { value: "Mine" },
  });
  await screen.findByText("Use saved version");
  fireEvent.click(screen.getByText("Use saved version"));
  expect(back).not.toHaveBeenCalled();
  expect(
    screen.getByRole("dialog", { name: "Discard your unsaved changes?" }),
  ).toBeVisible();
  fireEvent.click(screen.getByText("Cancel"));
  expect(screen.getByLabelText("Note title")).toHaveValue("Mine");
  expect(back).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("Use saved version"));
  fireEvent.click(
    screen
      .getByRole("dialog", { name: "Discard your unsaved changes?" })
      .querySelector("button.primary")!,
  );
  expect(back).toHaveBeenCalledTimes(1);
});
it("retains newer edits while an earlier conflict copy is being persisted", async () => {
  const update = vi
    .fn()
    .mockRejectedValue(
      new RevisionConflictError(
        { ...initial, title: "Other tab", revision: 2 },
        { ...initial, title: "Draft A" },
      ),
    );
  const { store, back } = setup(update);
  let complete!: (n: Note) => void;
  vi.mocked(store.create).mockImplementation(
    () => new Promise<Note>((resolve) => (complete = resolve)),
  );
  fireEvent.change(screen.getByLabelText("Note title"), {
    target: { value: "Draft A" },
  });
  await screen.findByText("Save draft as a copy");
  fireEvent.click(screen.getByText("Save draft as a copy"));
  expect(store.create).toHaveBeenCalledTimes(1);
  fireEvent.change(screen.getByLabelText("Note title"), {
    target: { value: "Draft B" },
  });
  await act(async () =>
    complete({ ...initial, id: "copy", title: "Draft A (conflict copy)" }),
  );
  expect(screen.getByLabelText("Note title")).toHaveValue("Draft B");
  expect(screen.getByText("Save draft as a copy")).toBeEnabled();
  expect(back).not.toHaveBeenCalled();
  expect(
    screen.getByText(
      "An earlier draft was saved as a copy. Your latest changes are still here.",
    ),
  ).toBeVisible();
  expect(screen.queryByText("Saved in this browser")).not.toBeInTheDocument();
});
