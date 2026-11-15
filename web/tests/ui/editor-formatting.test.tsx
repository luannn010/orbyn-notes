import { useLayoutEffect, useState } from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { NoteDocument } from "../../src/domain/contracts";
import { RichEditor } from "../../src/ui/RichEditor";
import { EditorTooltip } from "../../src/ui/editorFormatting";
import { checkClose, registerCloseGuard } from "../../src/desktop/closeGuard";
const initial: NoteDocument = {
  type: "doc",
  content: [
    { type: "paragraph", content: [{ type: "text", text: "A useful note" }] },
  ],
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
function setup(
  policy: "notes" | "journal" | "plain" = "notes",
  owned = true,
  readOnly = false,
) {
  const changes = vi.fn();
  function Owner() {
    const [document, save] = useState(initial);
    const [pending, setPending] = useState(false);
    useLayoutEffect(() => registerCloseGuard(() => !pending), [pending]);
    return (
      <RichEditor
        documentPolicy={policy}
        readOnly={readOnly}
        onUnsavedChange={owned ? setPending : undefined}
        document={document}
        onChange={(value) => {
          changes(value);
          save(value);
        }}
      />
    );
  }
  render(<Owner />);
  return changes;
}
it("shows named icon tooltips and preserves content through Rich/Markdown switching", async () => {
  const changes = setup();
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
it("edits Markdown through document transactions and keeps invalid source guarded", async () => {
  const changes = setup();
  await screen.findByRole("textbox", { name: "Note content" });
  fireEvent.click(screen.getByRole("button", { name: "Markdown" }));
  const source = screen.getByRole("textbox", { name: "Markdown source" });
  fireEvent.change(source, {
    target: { value: "## A heading\n\n**A bold note**" },
  });
  await waitFor(() => expect(changes).toHaveBeenCalled());
  const latest = changes.mock.lastCall?.[0] as NoteDocument;
  expect(latest.content[0]?.type).toBe("heading");
  fireEvent.change(source, { target: { value: "![unsupported](image.png)" } });
  expect(source).toHaveValue("![unsupported](image.png)");
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
it("opens the bounded formatting menu by keyboard and applies a block command", async () => {
  setup();
  const body = await screen.findByRole("textbox", { name: "Note content" });
  fireEvent.keyDown(body, { key: "F10", shiftKey: true });
  const menu = await screen.findByRole("menu", { name: "Formatting menu" });
  fireEvent.click(within(menu).getByRole("menuitem", { name: /^Subheading/ }));
  await waitFor(() =>
    expect(body.querySelector("h2")).toHaveTextContent("A useful note"),
  );
  fireEvent.contextMenu(body, { clientX: 9999, clientY: 9999 });
  const second = await screen.findByRole("menu", { name: "Formatting menu" });
  expect(parseFloat(second.style.left)).toBeLessThanOrEqual(innerWidth - 8);
  fireEvent.keyDown(second, { key: "Escape" });
  expect(
    screen.queryByRole("menu", { name: "Formatting menu" }),
  ).not.toBeInTheDocument();
});
it("serializes recovery copies and keeps newer source guarded until its own copy settles", async () => {
  setup();
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
  const recovery = screen.getByRole("button", { name: "Copy Markdown draft" });
  fireEvent.click(recovery);
  expect(recovery).toBeDisabled();
  fireEvent.change(source, { target: { value: "![newer](image.png)" } });
  fireEvent.click(recovery);
  expect(writeText).toHaveBeenCalledTimes(1);
  expect(writeText).toHaveBeenLastCalledWith("![old](image.png)");
  await act(async () => finishes[0]!());
  expect(checkClose()).toBe("draft");
  expect(source).toHaveValue("![newer](image.png)");
  expect(recovery).not.toBeDisabled();
  fireEvent.click(recovery);
  expect(writeText).toHaveBeenCalledTimes(2);
  expect(writeText).toHaveBeenLastCalledWith("![newer](image.png)");
  expect(checkClose()).toBe("draft");
  await act(async () => finishes[1]!());
  expect(checkClose()).toBe("allowed");
});
it("keeps context menus and tooltips inside their owning native dialog", async () => {
  render(
    <dialog open aria-label="Version history">
      <RichEditor
        document={initial}
        documentPolicy="notes"
        readOnly
        onChange={vi.fn()}
      />
      <EditorTooltip label="Inspect history">
        <button type="button">Inspect</button>
      </EditorTooltip>
    </dialog>,
  );
  const dialog = screen.getByRole("dialog", { name: "Version history" });
  expect(
    within(dialog).getByRole("button", { name: "Markdown" }),
  ).toBeDisabled();
  const body = await within(dialog).findByRole("textbox", {
    name: "Note content",
  });
  fireEvent.contextMenu(body, { clientX: 30, clientY: 40 });
  const menu = await within(dialog).findByRole("menu", {
    name: "Formatting menu",
  });
  expect(menu.parentElement).toBe(dialog);
  expect(
    document.body.querySelector(":scope > .editor-format-menu"),
  ).toBeNull();
  fireEvent.keyDown(menu, { key: "Escape" });
  fireEvent.focus(within(dialog).getByRole("button", { name: "Inspect" }));
  const tooltip = await within(dialog).findByRole("tooltip");
  expect(tooltip).toHaveTextContent("Inspect history");
  expect(tooltip.parentElement).toBe(dialog);
});
it("formats pasted Markdown from the keyboard and context menu without accepting HTML", async () => {
  setup();
  const body = await screen.findByRole("textbox", { name: "Note content" });
  fireEvent.paste(body, {
    clipboardData: {
      getData: (type: string) =>
        type === "text/plain" ? "## Pasted heading" : "",
      types: ["text/plain"],
    },
  });
  await waitFor(() =>
    expect(body.querySelector("h2")).toHaveTextContent("Pasted heading"),
  );
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { readText: vi.fn(async () => "\n- A pasted list\n- Another item") },
  });
  fireEvent.contextMenu(body, { clientX: 100, clientY: 100 });
  const menu = await screen.findByRole("menu", { name: "Formatting menu" });
  fireEvent.click(within(menu).getByRole("menuitem", { name: /^Paste/ }));
  await waitFor(() =>
    expect(body.querySelector("ul")).toHaveTextContent("A pasted list"),
  );
});
it("keeps undo and redo functional in Markdown source", async () => {
  setup();
  await screen.findByRole("textbox", { name: "Note content" });
  fireEvent.click(screen.getByRole("button", { name: "Markdown" }));
  const source = screen.getByRole("textbox", { name: "Markdown source" });
  fireEvent.change(source, { target: { value: "First edit" } });
  fireEvent.change(source, { target: { value: "Second edit" } });
  fireEvent.click(screen.getByRole("button", { name: "Undo" }));
  expect(source).toHaveValue("First edit");
  fireEvent.click(screen.getByRole("button", { name: "Redo" }));
  expect(source).toHaveValue("Second edit");
});

it.each(["journal", "plain"] as const)(
  "does not admit editable Markdown for %s even with an owner callback",
  async (policy) => {
    setup(policy);
    await screen.findByRole("textbox", { name: "Note content" });
    const button = screen.getByRole("button", { name: "Markdown" });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(
      screen.queryByRole("textbox", { name: "Markdown source" }),
    ).not.toBeInTheDocument();
  },
);
it("does not admit unowned Notes Markdown", async () => {
  setup("notes", false);
  await screen.findByRole("textbox", { name: "Note content" });
  expect(screen.getByRole("button", { name: "Markdown" })).toBeDisabled();
});
