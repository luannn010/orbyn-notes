import { describe, expect, it } from "vitest";
import { parseMarkdown } from "../../src/transfer";

describe("Markdown import tag identity", () => {
  it("normalises front-matter tags once on import", () => {
    const imported = parseMarkdown([
      {
        name: "tags.md",
        content: '---\ntags: ["a", "A", " a", ""]\n---\n\nBody\n',
      },
    ])[0]!;
    expect(imported.tags).toEqual(["a"]);
  });
});
