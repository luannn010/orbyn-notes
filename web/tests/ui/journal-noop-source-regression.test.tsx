import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { RichEditor, type EditorLinkControl } from "../../src/ui/RichEditor";
import type { NoteDocument } from "../../src/domain/contracts";

beforeEach(() => {
  Object.defineProperty(Range.prototype, "getClientRects", {
    configurable: true,
    value: () => [],
  });
  Object.defineProperty(Range.prototype, "getBoundingClientRect", {
    configurable: true,
    value: () => new DOMRect(10, 10, 1, 16),
  });
});

it("keeps a clean Journal link Apply free of document changes after source tracing was added", async () => {
  const href = "https://example.test/existing";
  const document: NoteDocument = {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "Existing link",
            marks: [{ type: "link", attrs: { href } }],
          },
        ],
      },
    ],
  };
  // Journal binds Apply to its unchanged draft generation. An equal-document
  // transaction must not notify ordinary onChange and invalidate that token.
  let draftGeneration = 0;
  const change = vi.fn(() => {
    draftGeneration++;
  });
  const accept = vi.fn();
  const beginApply = vi.fn(() => {
    const admittedGeneration = draftGeneration;
    return (value: NoteDocument, changed: boolean) => {
      if (draftGeneration !== admittedGeneration)
        throw new Error("The protected Journal draft changed during Apply.");
      accept(value, changed);
    };
  });
  const control: EditorLinkControl = {
    draft: null,
    valid: true,
    open: vi.fn(),
    change: vi.fn(),
    cancel: vi.fn(),
    beginApply,
  };
  render(
    <RichEditor
      document={document}
      onChange={change}
      ariaLabel="Journal entry"
      linkControl={control}
    />,
  );
  const editor = await screen.findByRole("textbox", { name: "Journal entry" });
  await act(async () => {
    editor.focus();
    const range = window.document.createRange();
    range.setStart(editor.querySelector("a")!.firstChild!, 3);
    range.collapse(true);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    window.document.dispatchEvent(new Event("selectionchange"));
  });
  fireEvent.click(screen.getByRole("button", { name: /^Link$/ }));
  expect(await screen.findByLabelText("URL")).toHaveValue(href);
  expect(change).not.toHaveBeenCalled();
  fireEvent.submit(screen.getByRole("dialog", { name: "Web link" }));
  await waitFor(() =>
    expect(
      screen.queryByRole("dialog", {
        name: "Web link",
      }),
    ).not.toBeInTheDocument(),
  );
  expect(beginApply).toHaveBeenCalledOnce();
  expect(accept).toHaveBeenCalledOnce();
  expect(accept.mock.calls[0]![1]).toBe(false);
  expect(change).not.toHaveBeenCalled();
  expect(control.cancel).not.toHaveBeenCalled();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(editor.querySelector("a")).toHaveAttribute("href", href);
  expect(editor).toHaveTextContent("Existing link");
  expect(editor).toHaveFocus();
});
