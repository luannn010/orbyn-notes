import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Note, NotesStore } from "../../src/domain/contracts";
import { checkClose } from "../../src/desktop/closeGuard";
import { NoteEditor } from "../../src/ui/NoteEditor";

vi.mock("../../src/ui/RichEditor", () => ({
  RichEditor: () => <div>Writing surface</div>,
}));
beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
});
afterEach(() => vi.unstubAllGlobals());
const note: Note = {
  id: "metadata",
  title: "Writing first",
  document: { type: "doc", content: [{ type: "paragraph" }] },
  tags: ["Ideas"],
  revision: 1,
  createdAt: "2026-11-15T00:00:00Z",
  updatedAt: "2026-11-15T01:15:00Z",
  trashedAt: null,
};
function fixture(readOnly = false) {
  const unexpected = vi.fn(async () => {
    throw Error("Unexpected mutation");
  });
  const store: NotesStore = {
    list: async () => [note],
    get: async () => note,
    create: unexpected,
    update: unexpected,
    trash: unexpected,
    restore: unexpected,
    erase: unexpected,
    subscribe: () => () => {},
    persistence: () => ({ status: "ready" }),
    close: vi.fn(),
  };
  const back = vi.fn();
  const view = render(
    <NoteEditor
      note={note}
      store={store}
      readOnly={readOnly}
      onSaved={vi.fn()}
      onBack={back}
      onTrash={vi.fn()}
      onExport={vi.fn()}
    />,
  );
  return { unexpected, back, view };
}
it("shows compact tag and real edit metadata before exposing tag controls on demand", () => {
  fixture();
  expect(
    screen.queryByRole("textbox", { name: "New tag" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Remove tag Ideas" }),
  ).not.toBeInTheDocument();
  expect(document.querySelector(".note-metadata time")).toHaveAttribute(
    "dateTime",
    note.updatedAt,
  );
  fireEvent.click(screen.getByRole("button", { name: "Manage note tags" }));
  expect(screen.getByRole("textbox", { name: "New tag" })).toBeVisible();
  expect(
    screen.getByRole("button", { name: "Remove tag Ideas" }),
  ).toBeVisible();
});
it("retains hidden tag drafts and reopens them when departure is blocked", async () => {
  const { unexpected, back } = fixture();
  const trigger = screen.getByRole("button", { name: "Manage note tags" });
  fireEvent.click(trigger);
  const input = screen.getByRole("textbox", { name: "New tag" });
  fireEvent.change(input, { target: { value: "Still deciding" } });
  fireEvent.keyDown(input, { key: "Escape" });
  expect(trigger).toHaveFocus();
  expect(
    screen.queryByRole("textbox", { name: "New tag" }),
  ).not.toBeInTheDocument();
  await act(async () => expect(checkClose()).toBe("draft"));
  expect(screen.getByRole("textbox", { name: "New tag" })).toHaveValue(
    "Still deciding",
  );
  fireEvent.click(screen.getByRole("button", { name: "Done editing tags" }));
  fireEvent.click(screen.getByRole("button", { name: "← Back to notes" }));
  expect(back).not.toHaveBeenCalled();
  expect(screen.getByRole("textbox", { name: "New tag" })).toHaveValue(
    "Still deciding",
  );
  fireEvent.click(screen.getByRole("button", { name: "Clear tag input" }));
  expect(checkClose()).toBe("allowed");
  expect(unexpected).not.toHaveBeenCalled();
});
it("keeps tag mutations unavailable in a read-only editor", () => {
  const { unexpected } = fixture(true);
  fireEvent.click(screen.getByRole("button", { name: "Manage note tags" }));
  expect(screen.getByRole("textbox", { name: "New tag" })).toHaveAttribute(
    "readOnly",
  );
  expect(screen.getByRole("button", { name: "Add tag" })).toBeDisabled();
  expect(
    screen.getByRole("button", { name: "Remove tag Ideas" }),
  ).toBeDisabled();
  expect(unexpected).not.toHaveBeenCalled();
});
