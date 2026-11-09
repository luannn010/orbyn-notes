import { render, screen, act } from "@testing-library/react";
import { it, expect, vi } from "vitest";
import { RichEditor } from "../../src/ui/RichEditor";
it("does not mutate or autosave an end-list document merely when focused", async () => {
  // JSDOM has no layout; ProseMirror's selection observer still requests range geometry.
  Object.defineProperty(Range.prototype, "getClientRects", {
    configurable: true,
    value: () => [],
  });
  Object.defineProperty(Range.prototype, "getBoundingClientRect", {
    configurable: true,
    value: () => new DOMRect(),
  });
  const change = vi.fn();
  render(
    <RichEditor
      document={{
        type: "doc",
        content: [
          {
            type: "bulletList",
            content: [
              {
                type: "listItem",
                content: [
                  {
                    type: "paragraph",
                    content: [{ type: "text", text: "Synthetic list item" }],
                  },
                ],
              },
            ],
          },
        ],
      }}
      onChange={change}
    />,
  );
  const editor = await screen.findByRole("textbox", { name: "Note content" });
  const before = editor.innerHTML;
  await act(async () => editor.focus());
  expect(editor.innerHTML).toBe(before);
  expect(change).not.toHaveBeenCalled();
});
