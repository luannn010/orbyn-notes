import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import type { NoteDocument } from "../../src/domain/contracts";
import { RichEditor } from "../../src/ui/RichEditor";

const plainDocument = {
  type: "doc" as const,
  content: [
    {
      type: "paragraph" as const,
      content: [{ type: "text" as const, text: "Trip notes" }],
    },
  ],
};

const linkedDocument = {
  type: "doc" as const,
  content: [
    {
      type: "paragraph" as const,
      content: [
        {
          type: "text" as const,
          text: "Trip notes",
          marks: [
            { type: "link", attrs: { href: "https://example.test/trip" } },
          ],
        },
      ],
    },
  ],
};

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

async function renderEditor(document: NoteDocument) {
  const change = vi.fn();
  render(<RichEditor document={document} onChange={change} />);
  const editor = await screen.findByRole("textbox", { name: "Note content" });
  await act(async () => editor.focus());
  return { editor, change };
}

async function selectRange(editor: HTMLElement, range: Range) {
  await act(async () => {
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
  });
  await act(async () => editor.focus());
}

async function selectAllText(editor: HTMLElement) {
  const paragraph = editor.querySelector("p")!;
  const range = document.createRange();
  range.setStart(paragraph.firstChild!, 0);
  range.setEnd(paragraph.firstChild!, "Trip notes".length);
  await selectRange(editor, range);
}

it("prefills the current URL when the selection is inside an existing link", async () => {
  const user = userEvent.setup();
  const prompt = vi.spyOn(window, "prompt");
  const alert = vi.spyOn(window, "alert");
  const { editor } = await renderEditor(linkedDocument);
  const anchor = editor.querySelector("a")!;
  const range = document.createRange();
  range.setStart(anchor.firstChild!, 3);
  range.collapse(true);
  await selectRange(editor, range);
  await user.click(screen.getByRole("button", { name: /^Link$/ }));
  expect(screen.getByRole("dialog", { name: "Web link" })).toBeVisible();
  expect(screen.getByLabelText("URL")).toHaveValue("https://example.test/trip");
  expect(prompt).not.toHaveBeenCalled();
  expect(alert).not.toHaveBeenCalled();
  vi.restoreAllMocks();
});

it("shows an inline error that describes the input and refuses to apply an invalid URL", async () => {
  const user = userEvent.setup();
  const prompt = vi.spyOn(window, "prompt");
  const alert = vi.spyOn(window, "alert");
  const { editor, change } = await renderEditor(plainDocument);
  await selectAllText(editor);
  await user.click(screen.getByRole("button", { name: /^Link$/ }));
  const input = screen.getByLabelText("URL");
  await user.type(input, "ftp://x{Enter}");
  const error = screen.getByRole("alert");
  expect(error).toHaveTextContent("Enter a valid web or email link.");
  expect(input).toHaveAttribute("aria-invalid", "true");
  const errorId = error.getAttribute("id");
  expect(errorId).toBeTruthy();
  expect((input.getAttribute("aria-describedby") ?? "").split(/\s+/)).toContain(
    errorId,
  );
  expect(document.getElementById(errorId!)).toHaveTextContent(
    "Enter a valid web or email link.",
  );
  expect(input).toHaveValue("ftp://x");
  expect(screen.getByRole("dialog", { name: "Web link" })).toBeVisible();
  expect(editor.querySelector("a")).toBeNull();
  expect(editor.textContent).toBe("Trip notes");
  expect(change).not.toHaveBeenCalled();
  expect(prompt).not.toHaveBeenCalled();
  expect(alert).not.toHaveBeenCalled();
  vi.restoreAllMocks();
});

it("cancels on Escape without changing the document and returns focus to the editor", async () => {
  const user = userEvent.setup();
  const prompt = vi.spyOn(window, "prompt");
  const alert = vi.spyOn(window, "alert");
  const { editor, change } = await renderEditor(plainDocument);
  await selectAllText(editor);
  await user.click(screen.getByRole("button", { name: /^Link$/ }));
  const input = screen.getByLabelText("URL");
  await user.type(input, "https://example.test/cancelled");
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("dialog", { name: "Web link" })).toBeNull();
  expect(editor).toHaveFocus();
  expect(editor.querySelector("a")).toBeNull();
  expect(editor.textContent).toBe("Trip notes");
  expect(change).not.toHaveBeenCalled();
  expect(prompt).not.toHaveBeenCalled();
  expect(alert).not.toHaveBeenCalled();
  vi.restoreAllMocks();
});

it("applies on Enter and returns focus to the editor", async () => {
  const user = userEvent.setup();
  const prompt = vi.spyOn(window, "prompt");
  const alert = vi.spyOn(window, "alert");
  const { editor, change } = await renderEditor(plainDocument);
  await selectAllText(editor);
  await user.click(screen.getByRole("button", { name: /^Link$/ }));
  const input = screen.getByLabelText("URL");
  await user.type(input, "https://example.test/applied{Enter}");
  expect(screen.queryByRole("dialog", { name: "Web link" })).toBeNull();
  expect(editor).toHaveFocus();
  expect(editor.querySelector("a")?.getAttribute("href")).toBe(
    "https://example.test/applied",
  );
  expect(editor.textContent).toBe("Trip notes");
  expect(change).toHaveBeenCalled();
  expect(prompt).not.toHaveBeenCalled();
  expect(alert).not.toHaveBeenCalled();
  vi.restoreAllMocks();
});
