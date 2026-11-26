// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { Note } from "../../src/domain/contracts";
import { renderMarkdownSnapshot } from "../../src/transfer";

const note: Note = {
  id: "one",
  title: "Title",
  tags: [],
  document: { type: "doc", content: [] },
  revision: 1,
  createdAt: "2026-01-01",
  updatedAt: "2026-01-01",
  trashedAt: null,
};

describe("Markdown export filenames", () => {
  it("does not split a surrogate pair at the filename limit", () => {
    const title = `${"a".repeat(99)}😀`;
    expect(renderMarkdownSnapshot([{ ...note, title }])[0]!.filename).toBe(
      `${"a".repeat(99)}-1.md`,
    );
  });

  it("keeps complete emoji within the filename limit", () => {
    const title = "😀".repeat(60);
    expect(renderMarkdownSnapshot([{ ...note, title }])[0]!.filename).toBe(
      `${"😀".repeat(50)}-1.md`,
    );
  });

  it("preserves sanitization and distinct index suffixes", () => {
    const notes = [
      note,
      { ...note, title: "A <note>/file: name. " },
      { ...note, title: "A <note>/file: name. " },
      { ...note, title: "... " },
    ];
    expect(renderMarkdownSnapshot(notes).map((item) => item.filename)).toEqual([
      "Title-1.md",
      "A -note--file- name-2.md",
      "A -note--file- name-3.md",
      "Untitled-4.md",
    ]);
  });
});
