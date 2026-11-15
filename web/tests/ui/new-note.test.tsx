import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { Note, NotesStore } from "../../src/domain/contracts";
import { NewNote } from "../../src/ui/NewNote";
vi.mock("../../src/ui/RichEditor", () => ({
  RichEditor: ({ onChange }: { onChange: (value: unknown) => void }) => (
    <div
      contentEditable
      role="textbox"
      aria-label="Note content"
      onInput={(event) =>
        onChange({
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [
                { type: "text", text: event.currentTarget.textContent },
              ],
            },
          ],
        })
      }
    />
  ),
}));
afterEach(() => vi.restoreAllMocks());
function setup(quick = false) {
  const create = vi.fn(
    async (input, id) =>
      ({
        ...input,
        id,
        revision: 1,
        createdAt: "2026-11-15",
        updatedAt: "2026-11-15",
        trashedAt: null,
      }) as Note,
  );
  const update = vi.fn(
    async (id, input, revision) =>
      ({
        ...input,
        id,
        revision: revision + 1,
        createdAt: "2026-11-15",
        updatedAt: "2026-11-15",
        trashedAt: null,
      }) as Note,
  );
  const back = vi.fn();
  render(
    <NewNote
      quick={quick}
      store={{ create, update } as unknown as NotesStore}
      initialTags={["trip"]}
      onSaved={vi.fn()}
      onBack={back}
    />,
  );
  return { create, update, back };
}
it("focuses an unpersisted title, inherits a tag, moves Enter to body and drops an untouched page", () => {
  const { create, back } = setup();
  const title = screen.getByRole("textbox", { name: "Note title" });
  expect(title).toHaveFocus();
  expect(screen.getByRole("status")).toHaveTextContent("Not saved yet");
  expect(screen.getByRole("button", { name: "Current note tags" })).toHaveTextContent("trip");
  fireEvent.keyDown(title, { key: "Enter" });
  expect(screen.getByRole("textbox", { name: "Note content" })).toHaveFocus();
  fireEvent.click(screen.getByRole("button", { name: "Back to notes" }));
  expect(back).toHaveBeenCalledOnce();
  expect(create).not.toHaveBeenCalled();
});
it("persists first content without template hint strings and undoes a starter through the same note", async () => {
  const { create, update } = setup();
  fireEvent.click(screen.getByRole("button", { name: /Meeting/ }));
  await waitFor(() => expect(create).toHaveBeenCalledOnce());
  expect(
    screen.queryByRole("group", { name: "Start from" }),
  ).not.toBeInTheDocument();
  expect(JSON.stringify(create.mock.calls[0]?.[0])).not.toContain(
    "What was said",
  );
  expect(screen.getByLabelText("Note title")).toHaveFocus();
  fireEvent.click(screen.getByRole("button", { name: "Undo starter" }));
  await waitFor(() => expect(update).toHaveBeenCalledOnce());
  expect(update.mock.calls[0]?.[0]).toBe(create.mock.calls[0]?.[1]);
  expect(screen.getByRole("group", { name: "Start from" })).toBeVisible();
});
it("keeps a failed quick draft open on Escape until its current text is copied", async () => {
  const store = {
    create: vi.fn().mockRejectedValue(new Error("quota")),
  } as unknown as NotesStore;
  const close = vi.fn();
  render(
    <NewNote
      quick
      store={store}
      onSaved={vi.fn()}
      onBack={vi.fn()}
      onClose={close}
    />,
  );
  fireEvent.change(screen.getByLabelText("Note title"), {
    target: { value: "Keep" },
  });
  await screen.findByText("quota");
  fireEvent.keyDown(screen.getByLabelText("Note title"), { key: "Escape" });
  expect(close).not.toHaveBeenCalled();
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: vi.fn(async () => {}) },
  });
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "Copy text" })),
  );
  fireEvent.keyDown(screen.getByLabelText("Note title"), { key: "Escape" });
  expect(close).toHaveBeenCalledOnce();
  expect(
    screen.queryByRole("group", { name: "Start from" }),
  ).not.toBeInTheDocument();
});

it("never hands off an older committed Quick revision after copying a failed newer edit", async () => {
  const create = vi.fn(async (input, id) => ({
    ...input,
    id,
    revision: 1,
    createdAt: "2026-11-15",
    updatedAt: "2026-11-15",
    trashedAt: null,
  }));
  const update = vi.fn().mockRejectedValue(new Error("quota")),
    open = vi.fn(async () => {});
  render(
    <NewNote
      quick
      store={{ create, update } as unknown as NotesStore}
      onSaved={vi.fn()}
      onBack={vi.fn()}
      onOpen={open}
    />,
  );
  fireEvent.change(screen.getByLabelText("Note title"), {
    target: { value: "Saved older" },
  });
  await screen.findByText("Saved to All notes", { selector: "footer span" });
  fireEvent.change(screen.getByLabelText("Note title"), {
    target: { value: "Newer failed" },
  });
  await screen.findByText("quota");
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: vi.fn(async () => {}) },
  });
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "Copy text" })),
  );
  expect(screen.getByRole("button", { name: "Open in Notes" })).toBeDisabled();
  fireEvent.keyDown(screen.getByLabelText("Note title"), {
    key: "Enter",
    ctrlKey: true,
  });
  expect(open).not.toHaveBeenCalled();
});
