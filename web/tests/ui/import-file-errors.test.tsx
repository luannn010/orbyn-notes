import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import type { Note, NotesStore } from "../../src/domain/contracts";
import { Workspace } from "../../src/ui/Workspace";

beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
});

it.each([
  { name: "bad.bin", text: async () => "not Markdown" },
  { name: "bad-metadata.md", text: async () => "---\ntags: 12\n---\nbody" },
  {
    name: "unreadable.md",
    text: async () => {
      throw new Error("Read failed");
    },
  },
])(
  "keeps valid files ready and names $name when that file fails",
  async (bad) => {
    const notes: Note[] = [];
    const create = vi.fn(async (input: Parameters<NotesStore["create"]>[0]) => {
      const note: Note = {
        ...input,
        id: `import-${notes.length}`,
        revision: 1,
        createdAt: "2026-11-26T00:00:00Z",
        updatedAt: "2026-11-26T00:00:00Z",
        trashedAt: null,
      };
      notes.push(note);
      return note;
    });
    const store = {
      list: vi.fn(async () => [...notes]),
      subscribe: () => () => {},
      create,
    } as unknown as NotesStore;
    const { container } = render(
      <Workspace
        store={store}
        session={{
          accountId: "test",
          deviceId: "test",
          email: "fixture@example.test",
          deviceState: "trusted",
        }}
        onSignOut={async () => {}}
      />,
    );
    await screen.findByRole("button", { name: /All notes/ });
    fireEvent.change(container.querySelector('input[type="file"]')!, {
      target: {
        files: [
          { name: "first.md", size: 7, text: async () => "# First" },
          { ...bad, size: 40 },
          { name: "last.md", size: 6, text: async () => "# Last" },
        ],
      },
    });
    const review = await screen.findByRole("dialog", {
      name: "Import Markdown",
    });
    expect(
      within(review).getByText(
        "2 files ready. Original files remain untouched.",
      ),
    ).toBeVisible();
    expect(within(review).getByRole("alert")).toHaveTextContent(bad.name);
    expect(create).not.toHaveBeenCalled();
    fireEvent.click(
      within(review).getByRole("button", { name: "Import remaining" }),
    );
    await waitFor(() => expect(create).toHaveBeenCalledTimes(2));
    expect(notes.map((note) => note.title)).toEqual(["First", "Last"]);
  },
);
