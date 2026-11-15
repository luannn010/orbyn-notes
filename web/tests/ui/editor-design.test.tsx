import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { Note, NotesStore } from "../../src/domain/contracts";
import { NoteEditor } from "../../src/ui/NoteEditor";
import { checkClose } from "../../src/desktop/closeGuard";
vi.mock("../../src/ui/RichEditor", () => ({
  RichEditor: ({
    onUnsavedChange,
    active,
  }: {
    onUnsavedChange?: (dirty: boolean) => void;
    active?: boolean;
  }) => (
    <button onClick={() => onUnsavedChange?.(true)} data-active={active}>
      Synthetic invalid source
    </button>
  ),
}));
const note: Note = {
  id: "design-note",
  title: "Lisbon trip, May",
  document: {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [{ type: "text", text: "Keep this text" }],
      },
    ],
  },
  tags: ["trip"],
  createdAt: "2026-11-01T00:00:00Z",
  updatedAt: "2026-11-01T00:00:00Z",
  revision: 1,
  trashedAt: null,
};
function setup(active = true) {
  const store = {
    create: vi.fn(async (input) => ({ ...note, ...input, id: "copy" })),
    update: vi.fn(),
  } as unknown as NotesStore;
  const back = vi.fn(),
    history = vi.fn(),
    exportNote = vi.fn(),
    trash = vi.fn();
  render(
    <NoteEditor
      note={note}
      store={store}
      active={active}
      onBack={back}
      onSaved={vi.fn()}
      onHistory={history}
      onTrash={trash}
      onExport={exportNote}
    />,
  );
  return { store, back, history, exportNote, trash };
}
it("renders the note breadcrumb and icon actions, and keeps unavailable actions Planned", () => {
  const { history } = setup();
  expect(
    within(screen.getByRole("navigation", { name: "Note location" })).getByText(
      "Lisbon trip, May",
    ),
  ).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Version history" }));
  expect(history).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("button", { name: "Note menu" }));
  const menu = screen.getByRole("menu", { name: "Note menu" });
  expect(
    within(menu).getByRole("menuitem", { name: "Lock note · Planned" }),
  ).toBeDisabled();
  expect(
    within(menu).getByRole("menuitem", { name: "Share… · Planned" }),
  ).toBeDisabled();
  expect(
    within(menu).getByRole("menuitem", { name: "Export PDF · Planned" }),
  ).toBeDisabled();
  expect(
    within(menu).getByRole("menuitem", { name: "Move to Trash" }),
  ).toHaveClass("danger");
});
it("blocks destructive and stale snapshot actions while source-only edits are retained", () => {
  const { store, back, exportNote, trash } = setup();
  fireEvent.click(screen.getByText("Synthetic invalid source"));
  expect(checkClose()).toBe("draft");
  fireEvent.click(screen.getByRole("button", { name: "← Back to notes" }));
  expect(back).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Note menu" }));
  expect(screen.getByRole("menuitem", { name: "Duplicate" })).toBeDisabled();
  expect(
    screen.getByRole("menuitem", { name: "Export Markdown" }),
  ).toBeDisabled();
  fireEvent.click(screen.getByRole("menuitem", { name: "Move to Trash" }));
  expect(trash).not.toHaveBeenCalled();
  expect(store.create).not.toHaveBeenCalled();
  expect(exportNote).not.toHaveBeenCalled();
});
it("uses F2 to select the whole title and Ctrl+D to duplicate the saved document once", async () => {
  const { store } = setup();
  const title = screen.getByLabelText("Note title") as HTMLTextAreaElement;
  fireEvent.keyDown(title, { key: "F2" });
  expect(title).toHaveFocus();
  expect(title.selectionEnd - title.selectionStart).toBe(note.title.length);
  fireEvent.keyDown(title, { key: "d", ctrlKey: true });
  fireEvent.keyDown(title, { key: "d", ctrlKey: true });
  await waitFor(() => expect(store.create).toHaveBeenCalledOnce());
  expect(store.create).toHaveBeenCalledWith({
    title: "Lisbon trip, May (copy)",
    document: note.document,
    tags: note.tags,
  });
});
it("does not handle keyboard actions for retained inactive note actors", () => {
  const { store } = setup(false);
  fireEvent.keyDown(screen.getByLabelText("Note title"), {
    key: "d",
    ctrlKey: true,
  });
  expect(store.create).not.toHaveBeenCalled();
  expect(screen.getByText("Synthetic invalid source")).toHaveAttribute(
    "data-active",
    "false",
  );
});
