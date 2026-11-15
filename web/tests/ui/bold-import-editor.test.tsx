import { act, render, screen, waitFor } from "@testing-library/react";
import type { Editor } from "@tiptap/react";
import type { NoteDocument } from "../../src/domain/contracts";
import {
  createMarkdownSource,
  parseMarkdownSource,
} from "../../src/editor/markdownSource";
import { expect, it, vi } from "vitest";
import { parseMarkdown } from "../../src/transfer";
import { RichEditor } from "../../src/ui/RichEditor";

it("opens imported bold text and preserves it when the editor is changed", async () => {
  const document = parseMarkdown([{ name: "bold.md", content: "**bold**" }])[0]!
    .document;
  const paragraph = document.content[0]!;
  expect(paragraph.content).toEqual([
    { type: "text", text: "bold", marks: [{ type: "bold" }] },
  ]);
  const onChange = vi.fn();
  render(<RichEditor document={document} onChange={onChange} />);
  const editor = await screen.findByRole("textbox", { name: "Note content" });
  expect(editor.querySelector("strong")).toHaveTextContent("bold");
  const tiptap = (editor as HTMLElement & { editor: Editor }).editor;
  act(() => {
    tiptap.commands.insertContentAt(tiptap.state.doc.content.size - 1, "X");
  });
  await waitFor(() => expect(onChange).toHaveBeenCalled());
  const saved = onChange.mock.lastCall![0];
  expect(JSON.stringify(saved)).toContain("bold");
  expect(JSON.stringify(saved)).toContain("X");
});

it("keeps bold source edits valid when switching back to rich text", () => {
  const original: NoteDocument = {
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: "original" }] },
    ],
  };
  const source = createMarkdownSource(original);
  const parsed = parseMarkdownSource("**bold** plus", source);
  expect(parsed.content[0]?.content).toEqual([
    { type: "text", text: "bold", marks: [{ type: "bold" }] },
    { type: "text", text: " plus" },
  ]);
});
