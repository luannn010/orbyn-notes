import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Note, NotesStore } from "../../src/domain/contracts";
import { NoteEditor } from "../../src/ui/NoteEditor";

vi.mock("../../src/ui/RichEditor", () => ({
  RichEditor: () => <div>Rich editor test boundary</div>,
}));

const note: Note = {
  id: "feedback-note",
  title: "Original",
  document: { type: "doc", content: [{ type: "paragraph" }] },
  tags: [],
  createdAt: "2026-11-11T00:00:00Z",
  updatedAt: "2026-11-11T00:00:00Z",
  trashedAt: null,
  revision: 1,
};

function storeWith(update: NotesStore["update"]): NotesStore {
  return {
    update,
    list: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    trash: vi.fn(),
    restore: vi.fn(),
    erase: vi.fn(),
    subscribe: vi.fn(),
    persistence: vi.fn(),
    close: vi.fn(),
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("clipboard recovery feedback", () => {
  it("keeps the save failure and continues autosaving after a copy failure", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("Clipboard denied"));
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const update = vi
      .fn<NotesStore["update"]>()
      .mockRejectedValueOnce(new Error("Storage denied"))
      .mockImplementation(async (_id, patch, revision) => ({
        ...note,
        ...patch,
        revision: revision + 1,
      }));
    render(
      <NoteEditor
        note={note}
        store={storeWith(update)}
        onSaved={vi.fn()}
        onBack={vi.fn()}
        onTrash={vi.fn()}
        onExport={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText("Note title"), {
      target: { value: "Draft" },
    });
    await screen.findByText("Storage denied");
    fireEvent.click(screen.getByRole("button", { name: "Copy text" }));
    await screen.findByText(
      "Couldn’t copy text. Select your text and copy it.",
    );
    expect(screen.getByText("Storage denied")).toBeVisible();

    // A new edit clears the old save failure and must schedule its own write.
    fireEvent.change(screen.getByLabelText("Note title"), {
      target: { value: "Newer draft" },
    });
    await screen.findByText("Saved in this browser");
    expect(update).toHaveBeenLastCalledWith(
      note.id,
      expect.objectContaining({ title: "Newer draft" }),
      1,
    );
    expect(screen.queryByText("Couldn’t save")).not.toBeInTheDocument();
    expect(
      screen.getByText("Couldn’t copy text. Select your text and copy it."),
    ).toBeVisible();
  });

  it("clears only the clipboard notice after copying succeeds", async () => {
    const writeText = vi
      .fn()
      .mockRejectedValueOnce(new Error("Clipboard denied"))
      .mockResolvedValueOnce(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const update = vi.fn().mockRejectedValue(new Error("Storage denied"));
    render(
      <NoteEditor
        note={note}
        store={storeWith(update)}
        onSaved={vi.fn()}
        onBack={vi.fn()}
        onTrash={vi.fn()}
        onExport={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText("Note title"), {
      target: { value: "Draft" },
    });
    await screen.findByText("Storage denied");
    fireEvent.click(screen.getByRole("button", { name: "Copy text" }));
    await screen.findByText(
      "Couldn’t copy text. Select your text and copy it.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Copy text" }));
    await waitFor(() =>
      expect(
        screen.queryByText("Couldn’t copy text. Select your text and copy it."),
      ).not.toBeInTheDocument(),
    );
    expect(screen.getByText("Storage denied")).toBeVisible();
    expect(screen.getByText("Couldn’t save")).toBeVisible();
  });
});
