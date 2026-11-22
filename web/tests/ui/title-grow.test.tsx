import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { Note, NotesStore } from "../../src/domain/contracts";
import { NoteEditor } from "../../src/ui/NoteEditor";
import { NewNote } from "../../src/ui/NewNote";
vi.mock("../../src/ui/RichEditor", () => ({
  RichEditor: () => <div>Rich editor test boundary</div>,
}));
afterEach(() => vi.restoreAllMocks());
const note: Note = {
  id: "n1",
  title: "Short",
  document: { type: "doc", content: [{ type: "paragraph" }] },
  tags: [],
  createdAt: "2026-01-01",
  updatedAt: "2026-01-01",
  revision: 1,
  trashedAt: null,
};
function mockScroll(height: () => number) {
  vi.spyOn(HTMLTextAreaElement.prototype, "scrollHeight", "get").mockImplementation(height);
}
it("sizes the editor title to its content on mount and as text changes", () => {
  let h = 35;
  mockScroll(() => h);
  render(
    <NoteEditor
      note={note}
      store={{ update: vi.fn(), subscribe: vi.fn() } as unknown as NotesStore}
      onSaved={vi.fn()}
      onBack={vi.fn()}
      onTrash={vi.fn()}
      onExport={vi.fn()}
    />,
  );
  const title = screen.getByLabelText("Note title") as HTMLTextAreaElement;
  expect(title.style.height).toBe("35px");
  h = 105;
  fireEvent.change(title, { target: { value: "A very long title ".repeat(10) } });
  expect(title.style.height).toBe("105px");
});
it("sizes the new-note title to its content", () => {
  let h = 38;
  mockScroll(() => h);
  render(
    <NewNote
      store={{ create: vi.fn(), update: vi.fn() } as unknown as NotesStore}
      initialTags={[]}
      onSaved={vi.fn()}
      onBack={vi.fn()}
    />,
  );
  const title = screen.getByLabelText("Note title") as HTMLTextAreaElement;
  expect(title.style.height).toBe("38px");
  h = 76;
  fireEvent.change(title, { target: { value: "word ".repeat(60) } });
  expect(title.style.height).toBe("76px");
});
