import { useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createNoteExtensions } from "../../src/editor/schema";
import type { NoteDocument } from "../../src/domain/contracts";
import { EditorFormatting, EditorTooltip } from "../../src/ui/editorFormatting";
import { checkClose } from "../../src/desktop/closeGuard";

const initial: NoteDocument = {
  type: "doc",
  content: [
    { type: "paragraph", content: [{ type: "text", text: "A useful note" }] },
  ],
};

// This is the direct component owner, not a substitute for NoteEditor save/route guards.
// The following integration slice supplies the application owner's unsaved-draft callback.
function Controls({
  onChange,
  onUnsavedChange = () => {},
  readOnly = false,
  sourceEditing = true,
}: {
  onChange: (document: NoteDocument) => void;
  onUnsavedChange?: (dirty: boolean) => void;
  readOnly?: boolean;
  sourceEditing?: boolean;
}) {
  const [markdown, setMarkdown] = useState(false);
  const editor = useEditor({
    extensions: createNoteExtensions(),
    content: initial,
    editable: !readOnly,
    immediatelyRender: false,
    editorProps: {
      attributes: { role: "textbox", "aria-label": "Note content" },
    },
    onUpdate: ({ editor: current }) =>
      onChange(current.getJSON() as NoteDocument),
  });
  if (!editor) return null;
  return (
    <>
      <EditorFormatting
        editor={editor}
        disabled={readOnly}
        active
        noteLinks={false}
        openLink={() => {}}
        openNote={() => {}}
        onViewChange={setMarkdown}
        {...(sourceEditing
          ? { sourceEditing: true as const, onUnsavedChange }
          : { sourceEditing: false as const })}
      />
      <div hidden={markdown}>
        <EditorContent editor={editor} />
      </div>
    </>
  );
}

beforeEach(() => {
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

it("does not admit Markdown source editing without an explicit draft owner", async () => {
  const changes = vi.fn();
  render(<Controls sourceEditing={false} onChange={changes} />);
  await screen.findByRole("textbox", { name: "Note content" });
  const markdown = screen.getByRole("button", { name: "Markdown" });
  expect(markdown).toBeDisabled();
  fireEvent.click(markdown);
  expect(
    screen.queryByRole("textbox", { name: "Markdown source" }),
  ).not.toBeInTheDocument();
  expect(changes).not.toHaveBeenCalled();
});

it("provides named tooltips and preserves the structured document when switching views", async () => {
  const changes = vi.fn();
  render(<Controls onChange={changes} />);
  await screen.findByRole("textbox", { name: "Note content" });
  const bold = screen.getByRole("button", { name: "Bold" });
  fireEvent.focus(bold);
  const tooltip = await screen.findByRole("tooltip");
  expect(tooltip).toHaveTextContent("**text**");
  expect(bold).toHaveAttribute("aria-describedby", tooltip.id);
  fireEvent.click(screen.getByRole("button", { name: "Markdown" }));
  expect(screen.getByRole("textbox", { name: "Markdown source" })).toHaveValue(
    "A useful note",
  );
  fireEvent.click(screen.getByRole("button", { name: "Rich" }));
  expect(
    screen.getByRole("textbox", { name: "Note content" }),
  ).toHaveTextContent("A useful note");
  expect(changes).not.toHaveBeenCalled();
});

it("applies valid source as a document transaction and retains invalid source behind its guard", async () => {
  const changes = vi.fn(),
    unsaved = vi.fn();
  render(<Controls onChange={changes} onUnsavedChange={unsaved} />);
  await screen.findByRole("textbox", { name: "Note content" });
  fireEvent.click(screen.getByRole("button", { name: "Markdown" }));
  const source = screen.getByRole("textbox", { name: "Markdown source" });
  fireEvent.change(source, {
    target: { value: "## Heading\n\n**A bold note**" },
  });
  await waitFor(() => expect(changes).toHaveBeenCalled());
  expect((changes.mock.lastCall?.[0] as NoteDocument).content[0]?.type).toBe(
    "heading",
  );
  const committedCalls = changes.mock.calls.length;
  fireEvent.change(source, { target: { value: "![unsupported](image.png)" } });
  expect(source).toHaveValue("![unsupported](image.png)");
  expect(changes).toHaveBeenCalledTimes(committedCalls);
  expect(unsaved).toHaveBeenLastCalledWith(true);
  expect(checkClose()).toBe("draft");
  fireEvent.click(screen.getByRole("button", { name: "Rich" }));
  expect(source).toBeVisible();
  fireEvent.click(
    screen.getByRole("button", { name: "Discard Markdown draft" }),
  );
  expect(
    screen.queryByRole("textbox", { name: "Markdown source" }),
  ).not.toBeInTheDocument();
  expect(checkClose()).toBe("allowed");
});

it("keeps a newer recovery draft guarded when an older clipboard write finishes", async () => {
  render(<Controls onChange={vi.fn()} />);
  await screen.findByRole("textbox", { name: "Note content" });
  fireEvent.click(screen.getByRole("button", { name: "Markdown" }));
  const source = screen.getByRole("textbox", { name: "Markdown source" });
  const finishes: (() => void)[] = [];
  const writeText = vi.fn(
    () => new Promise<void>((resolve) => finishes.push(resolve)),
  );
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
  fireEvent.change(source, { target: { value: "![old](image.png)" } });
  const copy = screen.getByRole("button", { name: "Copy Markdown draft" });
  fireEvent.click(copy);
  fireEvent.change(source, { target: { value: "![new](image.png)" } });
  expect(copy).toBeDisabled();
  await act(async () => finishes[0]!());
  expect(checkClose()).toBe("draft");
  expect(source).toHaveValue("![new](image.png)");
  fireEvent.click(copy);
  expect(writeText).toHaveBeenLastCalledWith("![new](image.png)");
  await act(async () => finishes[1]!());
  expect(checkClose()).toBe("allowed");
});

it("keeps context menus and tooltips in their owning modal and disables editing read-only content", async () => {
  const changes = vi.fn();
  render(
    <dialog open aria-label="History">
      <Controls readOnly onChange={changes} />
      <EditorTooltip label="Inspect history">
        <button type="button">Inspect</button>
      </EditorTooltip>
    </dialog>,
  );
  const dialog = screen.getByRole("dialog", { name: "History" });
  const body = await within(dialog).findByRole("textbox", {
    name: "Note content",
  });
  expect(within(dialog).getByRole("button", { name: "Bold" })).toBeDisabled();
  fireEvent.contextMenu(body, { clientX: 100, clientY: 100 });
  const menu = await within(dialog).findByRole("menu", {
    name: "Formatting menu",
  });
  expect(menu.parentElement).toBe(dialog);
  expect(
    document.body.querySelector(":scope > .editor-format-menu"),
  ).toBeNull();
  fireEvent.keyDown(menu, { key: "Escape" });
  fireEvent.focus(within(dialog).getByRole("button", { name: "Inspect" }));
  expect((await within(dialog).findByRole("tooltip")).parentElement).toBe(
    dialog,
  );
  expect(changes).not.toHaveBeenCalled();
});
