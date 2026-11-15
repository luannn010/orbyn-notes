import { useState } from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Note, NotesStore } from "../../src/domain/contracts";
import { RevisionConflictError } from "../../src/domain/contracts";
import { NoteEditor } from "../../src/ui/NoteEditor";
import { checkClose } from "../../src/desktop/closeGuard";
const note: Note = {
  id: "conflict-source",
  title: "Original",
  document: {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [{ type: "text", text: "Keep this body" }],
      },
    ],
  },
  tags: [],
  revision: 1,
  trashedAt: null,
  createdAt: "2026-11-01T00:00:00Z",
  updatedAt: "2026-11-01T00:00:00Z",
};
beforeEach(() => {
  localStorage.clear();
  Object.defineProperty(Range.prototype, "getClientRects", {
    configurable: true,
    value: () => [],
  });
  Object.defineProperty(Range.prototype, "getBoundingClientRect", {
    configurable: true,
    value: () => new DOMRect(),
  });
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => vi.restoreAllMocks());
function setup(create: NotesStore["create"]) {
  const back = vi.fn(),
    saved = vi.fn();
  const update = vi
    .fn()
    .mockRejectedValue(
      new RevisionConflictError(
        { ...note, revision: 2, title: "Another tab" },
        note,
      ),
    );
  function Owner() {
    const [open, setOpen] = useState(true);
    return open ? (
      <NoteEditor
        note={note}
        store={{ update, create } as unknown as NotesStore}
        onSaved={saved}
        onBack={() => {
          back();
          setOpen(false);
        }}
        onTrash={vi.fn()}
        onExport={vi.fn()}
      />
    ) : (
      <p>Library</p>
    );
  }
  render(<Owner />);
  return { back, saved, update };
}
async function conflict() {
  await screen.findByRole("textbox", { name: "Note content" });
  fireEvent.change(screen.getByRole("textbox", { name: "Note title" }), {
    target: { value: "My conflict draft" },
  });
  return screen.findByRole("button", { name: "Save draft as a copy" });
}
async function invalidSource() {
  fireEvent.click(
    screen.getByRole("button", { name: "Markdown" }),
  );
  const source = screen.getByRole("textbox", { name: "Markdown source" });
  fireEvent.change(source, {
    target: { value: "![keep this raw draft](unsupported.png)" },
  });
  expect(source).toHaveValue("![keep this raw draft](unsupported.png)");
  return source;
}
it("refuses conflict copy while a real invalid Markdown draft is pending", async () => {
  const create = vi.fn();
  const { back, saved } = setup(create);
  const copy = await conflict();
  const source = await invalidSource();
  expect(copy).toBeDisabled();
  fireEvent.click(copy);
  expect(create).not.toHaveBeenCalled();
  expect(back).not.toHaveBeenCalled();
  expect(saved).not.toHaveBeenCalled();
  expect(source).toHaveValue("![keep this raw draft](unsupported.png)");
  expect(checkClose()).toBe("draft");
});
it("retains raw Markdown entered while a conflict copy commit awaits completion", async () => {
  let finish!: (value: Note) => void;
  const create = vi.fn(
    () =>
      new Promise<Note>((resolve) => {
        finish = resolve;
      }),
  );
  const { back, saved } = setup(create);
  fireEvent.click(await conflict());
  await waitFor(() => expect(create).toHaveBeenCalledOnce());
  await invalidSource();
  await act(async () =>
    finish({
      ...note,
      id: "conflict-copy",
      title: "My conflict draft (conflict copy)",
    }),
  );
  expect(saved).toHaveBeenCalledOnce();
  expect(back).not.toHaveBeenCalled();
  expect(screen.getByRole("textbox", { name: "Markdown source" })).toHaveValue(
    "![keep this raw draft](unsupported.png)",
  );
  expect(screen.getByRole("textbox", { name: "Note title" })).toHaveValue(
    "My conflict draft",
  );
  expect(
    screen.getByText(
      "An earlier draft was saved as a copy. Your latest changes are still here.",
    ),
  ).toBeVisible();
  expect(checkClose()).toBe("draft");
});

