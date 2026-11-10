import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Note, NotesStore } from "../../src/domain/contracts";
import { NoteEditor } from "../../src/ui/NoteEditor";
vi.mock("../../src/ui/RichEditor", () => ({ RichEditor: () => <div /> }));
const note: Note = { id: "n", title: "Draft", document: { type: "doc", content: [{ type: "paragraph" }] }, tags: [], createdAt: "2026-01-01", updatedAt: "2026-01-01", revision: 1, trashedAt: null };
function setup(create: NotesStore["create"]) {
  const store = { create, update: vi.fn().mockRejectedValue(new Error("save failed")) } as unknown as NotesStore;
  const onTrash = vi.fn(), onExport = vi.fn();
  render(<NoteEditor note={note} store={store} onSaved={vi.fn()} onBack={vi.fn()} onTrash={onTrash} onExport={onExport} />);
  return { onTrash, onExport };
}
const open = () => fireEvent.click(screen.getByRole("button", { name: "Note menu" }));
describe("note actions", () => {
  it("renames by focusing the title and guards dirty actions", async () => {
    const { onTrash, onExport } = setup(vi.fn());
    open(); fireEvent.click(screen.getByRole("menuitem", { name: "Rename" }));
    const title = screen.getByRole("textbox", { name: "Note title" });
    expect(title).toHaveFocus();
    fireEvent.change(title, { target: { value: "Unsaved" } });
    open();
    expect(screen.getByRole("menuitem", { name: "Duplicate" })).toBeDisabled();
    expect(screen.getByRole("menuitem", { name: "Export Markdown" })).toBeDisabled();
    fireEvent.click(screen.getByRole("menuitem", { name: "Move to Trash" }));
    expect(onTrash).not.toHaveBeenCalled(); expect(onExport).not.toHaveBeenCalled();
    expect(screen.getByText(/latest changes are only in this window/)).toBeVisible();
  });
  it("prevents a second pending duplicate and permits retry after failure", async () => {
    let fail!: (error: Error) => void;
    const create = vi.fn().mockImplementationOnce(() => new Promise((_, reject) => { fail = reject; })).mockRejectedValue(new Error("again"));
    setup(create);
    open(); fireEvent.click(screen.getByRole("menuitem", { name: "Duplicate" }));
    open(); expect(screen.getByRole("menuitem", { name: "Duplicate" })).toBeDisabled();
    expect(create).toHaveBeenCalledTimes(1);
    fail(new Error("copy failed"));
    await screen.findByText("copy failed");
    await waitFor(() => expect(screen.getByRole("menuitem", { name: "Duplicate" })).toBeEnabled());
    fireEvent.click(screen.getByRole("menuitem", { name: "Duplicate" }));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(2));
  });
});
