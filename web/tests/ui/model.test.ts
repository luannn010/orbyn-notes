import { describe, it, expect } from "vitest";
import { plainText, projectNotes, safeLink } from "../../src/ui/model";
import type { Note, NoteDocument, RichNode } from "../../src/domain/contracts";
const note = (
  id: string,
  title: string,
  tags: string[] = [],
  trashedAt: string | null = null,
): Note => ({
  id,
  title,
  tags,
  trashedAt,
  document: {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          { type: "text", text: "A passage about encrypted libraries" },
        ],
      },
    ],
  },
  revision: 1,
  createdAt: "2026-01-01",
  updatedAt: "2026-01-01",
});
describe("collection projections", () => {
  it("searches content and tags while excluding Trash", () => {
    const list = [
      note("1", "Ideas", ["Work"]),
      note("2", "Archived", ["Work"], "2026-02-01"),
    ];
    expect(projectNotes(list, "encrypted", "", false).map((n) => n.id)).toEqual(
      ["1"],
    );
    expect(projectNotes(list, "work", "", true).map((n) => n.id)).toEqual([
      "2",
    ]);
    expect(projectNotes(list, "absent", "", false)).toEqual([]);
  });
  it("sorts equal edits by title then id", () => {
    expect(
      projectNotes(
        [note("3", "Beta"), note("2", "Alpha"), note("1", "Alpha")],
        "",
        "",
        false,
      ).map((n) => n.id),
    ).toEqual(["1", "2", "3"]);
  });
  it("rejects executable and ambiguous links", () => {
    for (const url of [
      "javascript:alert(1)",
      "data:text/html,hello",
      "//example.org",
      "/relative",
      "file:///tmp/note",
    ])
      expect(safeLink(url)).toBe(false);
    expect(safeLink("https://example.org")).toBe(true);
    expect(safeLink("mailto:hello@example.org")).toBe(true);
  });
});
const text = (value: string, ...marks: string[]): RichNode => ({
  type: "text",
  text: value,
  marks: marks.map((type) => ({ type })),
});
const paragraph = (...content: RichNode[]): RichNode => ({
  type: "paragraph",
  content,
});
const document = (...content: RichNode[]): NoteDocument => ({
  type: "doc",
  content,
});
describe("plain text projection", () => {
  it("keeps a word split by formatting whole", () => {
    expect(
      plainText(
        document(paragraph(text("Stra", "bold"), text("sse", "italic"))),
      ),
    ).toBe("Strasse");
  });
  it("keeps a marked word inside its sentence", () => {
    expect(
      plainText(document(paragraph(text("hello", "bold"), text(" world")))),
    ).toBe("hello world");
  });
  it("keeps one space at a hard break", () => {
    expect(
      plainText(
        document(
          paragraph(text("line one"), { type: "hardBreak" }, text("line two")),
        ),
      ),
    ).toBe("line one line two");
  });
  it("keeps one space between paragraphs", () => {
    expect(
      plainText(document(paragraph(text("first")), paragraph(text("second")))),
    ).toBe("first second");
  });
  it("keeps one space between list items", () => {
    expect(
      plainText(
        document({
          type: "bulletList",
          content: [
            { type: "listItem", content: [paragraph(text("one"))] },
            { type: "listItem", content: [paragraph(text("two"))] },
          ],
        }),
      ),
    ).toBe("one two");
  });
  it("ignores empty text nodes and empty paragraphs", () => {
    expect(
      plainText(
        document(
          paragraph(text("a"), text(""), text("b")),
          paragraph(),
          paragraph(text("c")),
        ),
      ),
    ).toBe("ab c");
  });
  it("finds words split by formatting in search", () => {
    const split: Note = {
      ...note("1", "Note"),
      document: document(paragraph(text("Stra", "bold"), text("sse"))),
    };
    expect(projectNotes([split], "strasse", "", false).map((n) => n.id)).toEqual(
      ["1"],
    );
    expect(projectNotes([split], "stra sse", "", false)).toEqual([]);
  });
});
