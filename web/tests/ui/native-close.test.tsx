import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { checkClose } from "../../src/desktop/closeGuard";
import { RevisionConflictError, type Note, type NotesStore } from "../../src/domain/contracts";
import { NoteEditor } from "../../src/ui/NoteEditor";
vi.mock("../../src/ui/RichEditor", () => ({ RichEditor: () => <div>Editor boundary</div> }));
const note: Note = { id: "n1", title: "Initial", document: { type: "doc", content: [{ type: "paragraph" }] }, tags: [], createdAt: "2026-01-01", updatedAt: "2026-01-01", revision: 1, trashedAt: null };
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function setup(update: NotesStore["update"], create = vi.fn()) {
  const store = { update, create } as unknown as NotesStore;
  return render(<NoteEditor note={note} store={store} onSaved={vi.fn()} onBack={vi.fn()} onTrash={vi.fn()} onExport={vi.fn()} />);
}
function change(title: string) { fireEvent.change(screen.getByLabelText("Note title"), { target: { value: title } }); }
function closeState() { let state!: ReturnType<typeof checkClose>; act(() => { state = checkClose(); }); return state; }
it("blocks immediately and keeps a newer edit blocked after an older save finishes", async () => {
  const first = deferred<Note>(); const second = deferred<Note>();
  const update = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  const view = setup(update); change("First");
  expect(closeState()).toBe("draft"); expect(update).not.toHaveBeenCalled();
  await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
  change("Newest"); await act(async () => first.resolve({ ...note, title: "First", revision: 2 }));
  expect(screen.getByLabelText("Note title")).toHaveValue("Newest"); expect(closeState()).toBe("draft");
  await waitFor(() => expect(update).toHaveBeenCalledTimes(2));
  await act(async () => second.resolve({ ...note, title: "Newest", revision: 3 }));
  expect(closeState()).toBe("allowed"); view.unmount(); expect(closeState()).toBe("allowed");
});
it("keeps a failed save and draft guarded, then removes its guard on unmount", async () => {
  const view = setup(vi.fn().mockRejectedValue(new Error("Storage denied")));
  change("Keep me"); await screen.findByText("Storage denied");
  expect(screen.getByLabelText("Note title")).toHaveValue("Keep me"); expect(closeState()).toBe("draft");
  view.unmount(); expect(closeState()).toBe("allowed");
});
it("blocks while a clean duplicate is being created", async () => {
  const copy = deferred<Note>(); const create = vi.fn().mockReturnValue(copy.promise);
  setup(vi.fn(), create); fireEvent.click(screen.getByRole("button", { name: "Note menu" }));
  fireEvent.click(screen.getByRole("menuitem", { name: /Duplicate/ }));
  expect(closeState()).toBe("draft");
  await act(async () => copy.resolve({ ...note, id: "copy" }));
  expect(closeState()).toBe("allowed");
});
it("keeps a conflict copy and newer edit guarded while persistence is pending", async () => {
  const copy = deferred<Note>();
  const update = vi.fn().mockRejectedValue(new RevisionConflictError({ ...note, revision: 2 }, { ...note, title: "Mine" }));
  setup(update, vi.fn().mockReturnValue(copy.promise)); change("Mine");
  fireEvent.click(await screen.findByText("Save draft as a copy"));
  expect(closeState()).toBe("draft"); change("Newer");
  await act(async () => copy.resolve({ ...note, id: "copy", title: "Mine (conflict copy)" }));
  expect(screen.getByLabelText("Note title")).toHaveValue("Newer"); expect(closeState()).toBe("draft");
});
