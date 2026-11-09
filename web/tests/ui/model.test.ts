import { describe, it, expect } from "vitest";
import { projectNotes, safeLink } from "../../src/ui/model";
import type { Note } from "../../src/domain/contracts";
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
