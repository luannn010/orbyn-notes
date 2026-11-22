import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { Workspace } from "../../src/ui/Workspace";
import type { Note, NotesStore } from "../../src/domain/contracts";

vi.mock("../../src/ui/RichEditor", () => ({ RichEditor: () => <div /> }));

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
});

const session = { accountId: "test", deviceId: "test", email: "fixture@example.test", deviceState: "trusted" as const };
const mk = (id: string, title: string): Note => ({
  id, title, document: { type: "doc", content: [{ type: "paragraph" }] }, tags: [],
  createdAt: "2026-01-01T00:00:00.000Z", updatedAt: `2026-01-0${id}T00:00:00.000Z`, revision: 1, trashedAt: null,
});
function storeWith(initial: Note[]) {
  let notes = initial;
  return {
    list: vi.fn(async () => notes),
    get: vi.fn(async (id: string) => notes.find((n) => n.id === id) ?? null),
    subscribe: () => () => {},
    persistence: () => ({ status: "ready" }),
    close: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    trash: vi.fn(async (id: string) => {
      const n = notes.find((x) => x.id === id)!;
      notes = notes.map((x) => (x.id === id ? { ...x, trashedAt: "2026-02-01T00:00:00.000Z" } : x));
      return { ...n, trashedAt: "2026-02-01T00:00:00.000Z" };
    }),
  } as unknown as NotesStore;
}
async function trashOpenNote(store: NotesStore, title: string) {
  render(<Workspace store={store} session={session} onSignOut={async () => {}} />);
  fireEvent.click(await screen.findByRole("button", { name: new RegExp(title) }));
  fireEvent.click(await screen.findByRole("button", { name: "Note menu" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "Move to Trash" }));
}

it("moves focus to a note row after Move to Trash", async () => {
  await trashOpenNote(storeWith([mk("2", "Beta"), mk("1", "Alpha")]), "Beta");
  await screen.findByText("Note moved to Trash");
  await waitFor(() => expect(document.body).not.toHaveFocus());
  expect(document.activeElement).toHaveClass("note-open");
});

it("moves focus to the list heading when Trash empties the list", async () => {
  await trashOpenNote(storeWith([mk("1", "Alpha")]), "Alpha");
  await screen.findByText("Note moved to Trash");
  await waitFor(() => expect(document.activeElement?.tagName).toBe("H1"));
});

it("returns focus to Import Markdown after the dialog closes", async () => {
  const { container } = render(<Workspace store={storeWith([mk("1", "Alpha")])} session={session} onSignOut={async () => {}} />);
  const trigger = await screen.findByRole("button", { name: "Import Markdown" });
  trigger.focus();
  fireEvent.click(trigger);
  // The hidden file picker steals focus before the dialog mounts.
  (document.activeElement as HTMLElement | null)?.blur();
  const file = { name: "a.md", size: 1, text: async () => "# a" };
  fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [file] } });
  const dialog = await screen.findByRole("dialog", { name: "Import Markdown" });
  expect(dialog).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Import Markdown" })).toBeNull());
  expect(screen.getByRole("button", { name: "Import Markdown" })).toHaveFocus();
});
