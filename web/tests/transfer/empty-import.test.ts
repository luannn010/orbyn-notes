import { expect, it } from "vitest";
import { parseMarkdown } from "../../src/transfer";
import { parseMarkdownSource } from "../../src/editor/markdownSource";

it.each([
  ["empty.md", ""],
  ["whitespace.md", "   \n\t\r\n"],
  ["bom.md", "\uFEFF"],
])("rejects %s with a message that names it", (name, content) => {
  expect(() => parseMarkdown([{ name, content }])).toThrow(
    `invalid_file: ${JSON.stringify(name)} is empty. Nothing was imported.`,
  );
});

it("names the empty file in a mixed batch and imports none of it", () => {
  expect(() =>
    parseMarkdown([
      { name: "plain.md", content: "plain" },
      { name: "blank.md", content: "\n  \n" },
    ]),
  ).toThrow(/invalid_file: "blank\.md" is empty/);
});

it("keeps importing non-empty files, including padded text and a title-only front matter block", () => {
  const [padded] = parseMarkdown([
    { name: "padded.md", content: "  A padded note  " },
  ]);
  expect(padded?.document.content[0]?.content?.[0]?.text).toBe("A padded note");
  const [titled] = parseMarkdown([
    {
      name: "titled.md",
      content: '---\ntitle: "Only a title"\ntags: []\n---\n',
    },
  ]);
  expect(titled?.title).toBe("Only a title");
});

it("keeps a blank Markdown source draft an empty note for the editor", () => {
  expect(parseMarkdownSource("")).toEqual({
    type: "doc",
    content: [{ type: "paragraph", content: [] }],
  });
  expect(parseMarkdownSource("   \n  ")).toEqual({
    type: "doc",
    content: [{ type: "paragraph", content: [] }],
  });
});
