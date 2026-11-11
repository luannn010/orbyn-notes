import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { NoteEditor } from "../../src/ui/NoteEditor";
import type { Note, NotesStore } from "../../src/domain/contracts";
const desktop = vi.hoisted(() => ({ toolbar: null as HTMLElement | null }));
vi.mock("../../src/desktop/DesktopShell", () => ({
  useDesktop: () => (desktop.toolbar ? { toolbar: desktop.toolbar } : null),
}));
vi.mock("../../src/ui/RichEditor", () => ({
  RichEditor: () => <div role="textbox" aria-label="Note content" />,
}));
afterEach(() => {
  desktop.toolbar?.remove();
  desktop.toolbar = null;
});
it("keeps only active Note chrome in the native portal and scopes Rename/title identity to that actor", () => {
  desktop.toolbar = document.createElement("div");
  document.body.append(desktop.toolbar);
  const note = (id: string): Note => ({
    id,
    title: id,
    revision: 1,
    document: { type: "doc", content: [{ type: "paragraph" }] },
    tags: [],
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    trashedAt: null,
  });
  const store: NotesStore = {
    list: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    trash: vi.fn(),
    restore: vi.fn(),
    erase: vi.fn(),
    subscribe: () => () => {},
    persistence: () => ({ status: "ready" }),
    close: vi.fn(),
  };
  const callbacks = {
    store,
    onSaved: vi.fn(),
    onBack: vi.fn(),
    onTrash: vi.fn(),
    onExport: vi.fn(),
  };
  render(
    <>
      <div hidden inert>
        <NoteEditor {...callbacks} active={false} note={note("Origin")} />
      </div>
      <NoteEditor {...callbacks} note={note("Current")} />
    </>,
  );
  expect(
    desktop.toolbar.querySelectorAll(".desktop-editor-actions"),
  ).toHaveLength(1);
  expect(document.querySelectorAll("#note-title")).toHaveLength(1);
  fireEvent.click(
    within(desktop.toolbar).getByRole("button", { name: "Note menu" }),
  );
  fireEvent.click(screen.getByRole("menuitem", { name: "Rename" }));
  expect(screen.getByRole("textbox", { name: "Note title" })).toHaveFocus();
  expect(screen.getByRole("textbox", { name: "Note title" })).toHaveValue(
    "Current",
  );
  expect(store.update).not.toHaveBeenCalled();
});
