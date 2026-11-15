import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import type { Note } from "../../src/domain/contracts";
import { exportMarkdown, parseMarkdown } from "../../src/transfer";
import { RichEditor } from "../../src/ui/RichEditor";

it("preserves mixed task and ordinary bullets through import, editor and export", async () => {
  const imported = parseMarkdown([
    {
      name: "mixed.md",
      content: "- [x] done\n- ordinary\n- [ ] next\n- plain",
    },
  ])[0]!;
  const note: Note = {
    ...imported,
    id: "mixed",
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01",
    revision: 1,
    trashedAt: null,
  };
  render(<RichEditor document={note.document} onChange={() => {}} />);
  const editor = await screen.findByRole("textbox", { name: "Note content" });
  expect(editor.querySelectorAll('input[type="checkbox"]')).toHaveLength(2);
  expect(editor).toHaveTextContent("done");
  expect(editor).toHaveTextContent("ordinary");
  const exported = exportMarkdown([note])[0]!;
  const reparsed = parseMarkdown([
    { name: exported.filename, content: exported.content },
  ])[0]!;
  expect(reparsed.document).toEqual(imported.document);
  expect(exported.content).toMatch(/- \[x\] done/);
  expect(exported.content).toMatch(/- ordinary/);
  expect(exported.content).not.toMatch(/\[ \] ordinary/);
});

it("keeps a formatted task and ordinary bullet readable through the editor and round trip", async () => {
  const imported = parseMarkdown([
    { name: "mixed.md", content: "- [x] `done`\n- ordinary" },
  ])[0]!;
  const note: Note = {
    ...imported,
    id: "formatted",
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01",
    revision: 1,
    trashedAt: null,
  };
  const first =
    imported.document.content[0]?.content?.[0]?.content?.[0]?.content ?? [];
  expect(
    first.every((node) => node.type !== "text" || Boolean(node.text)),
  ).toBe(true);
  render(<RichEditor document={note.document} onChange={() => {}} />);
  const editor = await screen.findByRole("textbox", { name: "Note content" });
  expect(editor.querySelector("code")).toHaveTextContent("done");
  expect(editor.querySelectorAll('input[type="checkbox"]')).toHaveLength(1);
  expect(editor).toHaveTextContent("ordinary");
  const exported = exportMarkdown([note])[0]!;
  const reparsed = parseMarkdown([
    { name: exported.filename, content: exported.content },
  ])[0]!;
  expect(reparsed.document).toEqual(imported.document);
});
