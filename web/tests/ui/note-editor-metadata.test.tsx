import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Note, NotesStore } from "../../src/domain/contracts";
import { checkClose } from "../../src/desktop/closeGuard";
import { NoteEditor } from "../../src/ui/NoteEditor";
import { CompactNoteTags } from "../../src/ui/CompactNoteTags";

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
function fixture(readOnly = false, update?: NotesStore["update"]) {
  const unexpected = vi.fn(async () => {
    throw Error("Unexpected mutation");
  });
  const store: NotesStore = {
    list: async () => [note],
    get: async () => note,
    create: unexpected,
    update: update ?? unexpected,
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
      onOpenTag={vi.fn()}
      onTrash={vi.fn()}
      onExport={vi.fn()}
    />,
  );
  return { unexpected, back, view };
}
it("shows individual hashtags and a separate edit action without a separate form", () => {
  fixture();
  expect(
    screen.queryByRole("textbox", { name: "Tags, separated by commas" }),
  ).not.toBeInTheDocument();
  expect(
    screen.getByRole("group", { name: "Current note tags" }),
  ).toHaveTextContent("Ideas");
  expect(
    screen.getByRole("button", { name: "Manage note tags" }),
  ).toHaveTextContent("Edit tags");
  expect(document.querySelector(".note-metadata time")).toHaveAttribute(
    "dateTime",
    note.updatedAt,
  );
  fireEvent.click(screen.getByRole("button", { name: "Manage note tags" }));
  expect(screen.getByLabelText("Tags, separated by commas")).toHaveValue(
    "Ideas",
  );
  expect(screen.getByLabelText("Tags, separated by commas")).toHaveFocus();
  expect(screen.queryByText("Done")).not.toBeInTheDocument();
});
it("cancels with Escape and leaves saved tags untouched", () => {
  const { unexpected } = fixture();
  fireEvent.click(screen.getByRole("button", { name: "Manage note tags" }));
  const input = screen.getByLabelText("Tags, separated by commas");
  fireEvent.change(input, { target: { value: "Still deciding" } });
  expect(checkClose()).toBe("draft");
  fireEvent.keyDown(input, { key: "Escape" });
  expect(
    screen.getByRole("group", { name: "Current note tags" }),
  ).toHaveTextContent("Ideas");
  expect(checkClose()).toBe("allowed");
  expect(unexpected).not.toHaveBeenCalled();
});
it("applies a comma list on Enter through the normal save contract", async () => {
  const update = vi.fn(async (_id, patch, revision) => ({
    ...note,
    ...patch,
    revision: revision + 1,
  }));
  fixture(false, update);
  fireEvent.click(screen.getByRole("button", { name: "Manage note tags" }));
  const input = screen.getByLabelText("Tags, separated by commas");
  fireEvent.change(input, {
    target: { value: "Ideas, #trip, trip, planning" },
  });
  fireEvent.keyDown(input, { key: "Enter" });
  await waitFor(() => expect(update).toHaveBeenCalledOnce());
  expect(update.mock.calls[0]![1].tags).toEqual(["Ideas", "trip", "planning"]);
  expect(
    screen.queryByRole("textbox", { name: "Tags, separated by commas" }),
  ).not.toBeInTheDocument();
});
it("guards an empty edit until it is committed or cancelled", () => {
  const { unexpected, back } = fixture();
  fireEvent.click(screen.getByRole("button", { name: "Manage note tags" }));
  const input = screen.getByLabelText("Tags, separated by commas");
  fireEvent.change(input, { target: { value: "" } });
  expect(checkClose()).toBe("draft");
  fireEvent.click(screen.getByRole("button", { name: "← Back to notes" }));
  expect(back).not.toHaveBeenCalled();
  fireEvent.keyDown(input, { key: "Escape" });
  expect(checkClose()).toBe("allowed");
  expect(unexpected).not.toHaveBeenCalled();
});
it("keeps invalid input visible and guarded on blur", () => {
  const { unexpected } = fixture();
  fireEvent.click(screen.getByRole("button", { name: "Manage note tags" }));
  const input = screen.getByLabelText("Tags, separated by commas");
  fireEvent.change(input, { target: { value: "x".repeat(101) } });
  fireEvent.blur(input);
  expect(screen.getByRole("alert")).toHaveTextContent("100 characters");
  expect(input).toHaveValue("x".repeat(101));
  expect(checkClose()).toBe("draft");
  fireEvent.keyDown(input, { key: "Escape" });
  expect(unexpected).not.toHaveBeenCalled();
});
it("retains committed tag text when the encrypted write fails", async () => {
  const { unexpected } = fixture();
  fireEvent.click(screen.getByRole("button", { name: "Manage note tags" }));
  const input = screen.getByLabelText("Tags, separated by commas");
  fireEvent.change(input, { target: { value: "Ideas, trip" } });
  fireEvent.blur(input);
  await screen.findByText("Unexpected mutation");
  expect(
    screen.getByRole("group", { name: "Current note tags" }),
  ).toHaveTextContent("#Ideas#trip");
  expect(
    screen.queryByRole("button", { name: "Show notes tagged trip" }),
  ).not.toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Show notes tagged Ideas" }),
  ).toBeVisible();
  expect(checkClose()).toBe("draft");
  expect(unexpected).toHaveBeenCalledOnce();
});
it("leaves tag editing unavailable in a read-only note", () => {
  const { unexpected } = fixture(true);
  expect(
    screen.getByRole("button", { name: "Manage note tags" }),
  ).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Manage note tags" }));
  expect(
    screen.queryByLabelText("Tags, separated by commas"),
  ).not.toBeInTheDocument();
  expect(unexpected).not.toHaveBeenCalled();
});

it.each(["work\nplay", "work\rplay"])(
  "preserves legacy line-break tag identity %j without projecting it into a text input",
  (legacy) => {
    const change = vi.fn();
    render(<CompactNoteTags tags={[legacy, "ideas"]} onChange={change} />);
    fireEvent.click(screen.getByRole("button", { name: "Manage note tags" }));
    expect(screen.getByRole("alert")).toHaveTextContent("line break");
    expect(
      screen.queryByLabelText("Tags, separated by commas"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("group", { name: "Current note tags" }).textContent,
    ).toBe(`#${legacy}#ideas`);
    expect(change).not.toHaveBeenCalled();
  },
);
