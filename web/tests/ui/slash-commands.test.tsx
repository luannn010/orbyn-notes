import { act, render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { RichEditor } from "../../src/ui/RichEditor";

beforeEach(() => {
  window.scrollBy = vi.fn();
  Object.defineProperty(Range.prototype, "getClientRects", {
    configurable: true,
    value: () => [],
  });
  Object.defineProperty(Range.prototype, "getBoundingClientRect", {
    configurable: true,
    value: () => new DOMRect(10, 10, 1, 16),
  });
});

async function setup() {
  const change = vi.fn();
  render(
    <RichEditor
      document={{ type: "doc", content: [{ type: "paragraph" }] }}
      onChange={change}
    />,
  );
  const editor = await screen.findByRole("textbox", { name: "Note content" });
  const user = userEvent.setup({ skipClick: true });
  await act(async () => editor.focus());
  return { editor, user, change };
}

it("filters case-insensitively while retaining editor focus and dismisses unchanged query", async () => {
  const { editor, user } = await setup();
  await user.type(editor, "/LIN");
  expect(screen.getAllByRole("option")).toHaveLength(1);
  expect(screen.getByRole("option", { name: "Web link" })).toBeTruthy();
  expect(document.activeElement).toBe(editor);
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("listbox")).toBeNull();
  expect(editor.textContent).toBe("/LIN");
  fireEvent.keyUp(editor, { key: "Escape" });
  expect(screen.queryByRole("listbox")).toBeNull();
});

it("shows no matches without an active descendant", async () => {
  const { editor, user } = await setup();
  await user.type(editor, "/xyz");
  expect(screen.getByText("No matching commands")).toBeTruthy();
  expect(editor.hasAttribute("aria-activedescendant")).toBe(false);
});

it("keeps a canceled or invalid link query and inserts a valid link", async () => {
  const { editor, user } = await setup();
  const prompt = vi.spyOn(window, "prompt");
  const alert = vi.spyOn(window, "alert");
  await user.type(editor, "/l");
  fireEvent.mouseDown(screen.getByRole("option", { name: "Web link" }));
  fireEvent.click(screen.getByRole("option", { name: "Web link" }));
  expect(screen.getByRole("dialog", { name: "Web link" })).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  expect(editor.textContent).toBe("/l");
  await user.type(editor, "i");
  fireEvent.mouseDown(screen.getByRole("option", { name: "Web link" }));
  fireEvent.click(screen.getByRole("option", { name: "Web link" }));
  await user.type(screen.getByLabelText("URL"), "javascript:bad");
  await user.click(screen.getByRole("button", { name: "Apply link" }));
  expect(screen.getByText("Enter a valid web or email link.")).toBeVisible();
  expect(editor.textContent).toBe("/li");
  await user.clear(screen.getByLabelText("URL"));
  await user.type(screen.getByLabelText("URL"), "https://example.com{Enter}");
  expect(editor.querySelector("a")?.getAttribute("href")).toBe(
    "https://example.com",
  );
  expect(editor.textContent).toBe("https://example.com");
  expect(prompt).not.toHaveBeenCalled();
  expect(alert).not.toHaveBeenCalled();
  vi.restoreAllMocks();
});

it("does not open during composition", async () => {
  const { editor, user } = await setup();
  fireEvent.compositionStart(editor);
  await user.type(editor, "/");
  expect(screen.queryByRole("listbox")).toBeNull();
  await act(async () => {
    fireEvent.compositionEnd(editor);
  });
  expect(screen.getByRole("listbox")).toBeTruthy();
});

it("undo restores the query after a block command", async () => {
  const { editor, user } = await setup();
  await user.type(editor, "/heading{Enter}");
  expect(editor.querySelector("h2")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Undo" }));
  expect(editor.textContent).toBe("/heading");
});
it("closes on blur without writing", async () => {
  const { editor, user, change } = await setup();
  await user.type(editor, "/heading");
  const writes = change.mock.calls.length;
  fireEvent.blur(editor);
  expect(screen.queryByRole("listbox")).toBeNull();
  expect(change).toHaveBeenCalledTimes(writes);
});

it("does not reopen when a slash document replaces the current document", async () => {
  const first = {
    type: "doc" as const,
    content: [{ type: "paragraph" as const }],
  };
  const change = vi.fn();
  const { rerender } = render(
    <RichEditor document={first} onChange={change} />,
  );
  const editor = await screen.findByRole("textbox", { name: "Note content" });
  await act(async () => editor.focus());
  const user = userEvent.setup({ skipClick: true });
  await user.type(editor, "/");
  expect(screen.getByRole("listbox")).toBeTruthy();
  rerender(
    <RichEditor
      document={{
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "/link" }] },
        ],
      }}
      onChange={change}
    />,
  );
  expect(screen.queryByRole("listbox")).toBeNull();
});

it("keeps dismissal scoped to its original block across a preceding edit", async () => {
  const change = vi.fn();
  render(
    <RichEditor
      document={{
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "prefix" }] },
          { type: "paragraph" },
          { type: "paragraph" },
        ],
      }}
      onChange={change}
    />,
  );
  const editor = await screen.findByRole("textbox", { name: "Note content" });
  const user = userEvent.setup({ skipClick: true });
  await act(async () => editor.focus());
  const select = async (node: Node, offset: number) => {
    await act(async () => {
      const range = document.createRange();
      range.setStart(node, offset);
      range.collapse(true);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      document.dispatchEvent(new Event("selectionchange"));
    });
  };
  const paragraphs = editor.querySelectorAll("p");
  await select(paragraphs[1]!, 0);
  await user.type(editor, "/link{Escape}");
  await select(paragraphs[2]!, 0);
  await user.type(editor, "/link");
  expect(screen.getByRole("option", { name: "Web link" })).toBeTruthy();
  await select(paragraphs[0]!.firstChild!, 6);
  await user.type(editor, "x");
  await select(paragraphs[1]!.firstChild!, 5);
  expect(screen.queryByRole("listbox")).toBeNull();
  await user.type(editor, "s");
  expect(screen.getByRole("listbox")).toBeTruthy();
});
