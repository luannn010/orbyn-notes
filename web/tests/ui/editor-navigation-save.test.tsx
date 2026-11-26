import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import type { Note, NotesStore } from "../../src/domain/contracts";
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
const leaveWarning = /Save or copy your text before leaving/;
function blockingSave() {
  let release!: () => void;
  const update = vi.fn(
    (_id: string, patch: Partial<Note>, revision: number) =>
      new Promise<Note>((resolve) => {
        release = () =>
          resolve({ ...initial, ...patch, revision: revision + 1 });
      }),
  ) as NotesStore["update"];
  return { update, release: () => release() };
}
function setup(update: NotesStore["update"]) {
  const create = vi.fn(async (input: Partial<Note>) => ({
    ...initial,
    ...input,
    id: "copy",
  }));
  const store = {
    update,
    create,
    trash: vi.fn(),
    restore: vi.fn(),
    list: vi.fn(),
    get: vi.fn(),
    erase: vi.fn(),
    subscribe: vi.fn(),
    persistence: vi.fn(),
    close: vi.fn(),
  } as unknown as NotesStore;
  const back = vi.fn(),
    trash = vi.fn(),
    exportNote = vi.fn();
  const view = render(
    <NoteEditor
      note={initial}
      store={store}
      onSaved={vi.fn()}
      onBack={back}
      onTrash={trash}
      onExport={exportNote}
    />,
  );
  return { store, back, trash, exportNote, view };
}
function editTitle(value: string) {
  fireEvent.change(screen.getByLabelText("Note title"), {
    target: { value },
  });
}
function openMenu() {
  fireEvent.click(screen.getByRole("button", { name: "Note menu" }));
}
describe("leaving while a save is pending", () => {
  it("waits for the pending save on Back, then navigates without a warning", async () => {
    const { update, release } = blockingSave();
    const { back } = setup(update);
    editTitle("Save then leave");
    fireEvent.click(screen.getByText("← Back to notes"));
    expect(back).not.toHaveBeenCalled();
    expect(screen.queryByText(leaveWarning)).not.toBeInTheDocument();
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(back).not.toHaveBeenCalled();
    // A slow save reuses the editor status instead of the destructive warning.
    await waitFor(
      () => expect(screen.getByRole("status")).toHaveTextContent("Saving…"),
      { timeout: 3000 },
    );
    expect(screen.queryByText(leaveWarning)).not.toBeInTheDocument();
    await act(async () => release());
    await waitFor(() => expect(back).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(leaveWarning)).not.toBeInTheDocument();
  });
  it("keeps a tag draft opened while Back waits for an active autosave", async () => {
    const { update, release } = blockingSave();
    const { back } = setup(update);
    editTitle("Autosaving");
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByText("← Back to notes"));
    expect(back).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Manage note tags" }));
    const input = screen.getByLabelText("Tags, separated by commas");
    fireEvent.change(input, { target: { value: "uncommitted tag" } });
    await act(async () => release());
    expect(back).not.toHaveBeenCalled();
    expect(input).toHaveValue("uncommitted tag");
    expect(
      screen.getByText("Apply or cancel your tag edit before leaving."),
    ).toBeVisible();
    fireEvent.keyDown(input, { key: "Escape" });
    fireEvent.click(screen.getByText("← Back to notes"));
    expect(back).toHaveBeenCalledTimes(1);
  });
  it("does not navigate after the editor unmounts while autosave is pending", async () => {
    const { update, release } = blockingSave();
    const { back, view } = setup(update);
    editTitle("Autosaving");
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByText("← Back to notes"));
    view.unmount();
    await act(async () => release());
    expect(back).not.toHaveBeenCalled();
  });
  it("keeps the warning and stays on Back when the pending save fails", async () => {
    const { back } = setup(vi.fn().mockRejectedValue(new Error("Storage denied")));
    editTitle("Never saved");
    fireEvent.click(screen.getByText("← Back to notes"));
    await screen.findByText(leaveWarning);
    expect(back).not.toHaveBeenCalled();
    await screen.findByText("Storage denied");
    expect(screen.getByText("Copy text")).toBeVisible();
  });
  it("waits for the pending save on Move to Trash, then trashes", async () => {
    const { update, release } = blockingSave();
    const { trash } = setup(update);
    editTitle("Trash after save");
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Move to Trash" }));
    expect(trash).not.toHaveBeenCalled();
    expect(screen.queryByText(leaveWarning)).not.toBeInTheDocument();
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(trash).not.toHaveBeenCalled();
    await act(async () => release());
    await waitFor(() => expect(trash).toHaveBeenCalledTimes(1));
    expect(trash).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Trash after save", revision: 2 }),
    );
    expect(screen.queryByText(leaveWarning)).not.toBeInTheDocument();
  });
  it("keeps the warning and does not trash when the pending save fails", async () => {
    const { trash } = setup(vi.fn().mockRejectedValue(new Error("Storage denied")));
    editTitle("Never saved");
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Move to Trash" }));
    await screen.findByText(leaveWarning);
    expect(trash).not.toHaveBeenCalled();
    await screen.findByText("Storage denied");
  });
});
describe("toolbar actions while a save is pending", () => {
  it("flushes the pending save before Duplicate and Export", async () => {
    const { update, release } = blockingSave();
    const { store, exportNote } = setup(update);
    editTitle("Flushed");
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Duplicate" }));
    expect(store.create).not.toHaveBeenCalled();
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    await act(async () => release());
    await waitFor(() => expect(store.create).toHaveBeenCalledTimes(1));
    expect(store.create).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Flushed (copy)" }),
    );
    editTitle("Exported");
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Export Markdown" }));
    expect(exportNote).not.toHaveBeenCalled();
    await waitFor(() => expect(update).toHaveBeenCalledTimes(2));
    await act(async () => release());
    await waitFor(() => expect(exportNote).toHaveBeenCalledTimes(1));
    expect(exportNote).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Exported", revision: 3 }),
    );
  });
});
