import { expect, it } from "vitest";
import {
  createMarkdownSource,
  parseMarkdownSource,
} from "../../src/editor/markdownSource";
import type { NoteDocument } from "../../src/domain/contracts";
it.each([
  "https://example.test/?x=&copy;",
  "https://example.test/?x=&#169;&other=1",
  "https://example.test/a(b)",
  "https://example.test/caf%C3%A9",
  "https://example.test/a%5Cb%3Cc%3E?x=&copy;",
])(
  "preserves an external destination after unrelated source edits: %s",
  (href) => {
    const document: NoteDocument = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "Link",
              marks: [{ type: "link", attrs: { href } }],
            },
          ],
        },
      ],
    };
    const source = createMarkdownSource(document);
    const edited = parseMarkdownSource(source.text + "\n\nExtra", source);
    expect(edited.content[0]?.content?.[0]?.marks?.[0]?.attrs?.href).toBe(href);
  },
);
it.each([
  "https://example.test/a\\b",
  "https://example.test/a<b>",
  "https://example.test/café",
])(
  "refuses source admission when the parser normalizes a stored destination: %s",
  (href) => {
    const document: NoteDocument = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "Link",
              marks: [{ type: "link", attrs: { href } }],
            },
          ],
        },
      ],
    };
    const original = structuredClone(document);
    expect(() => createMarkdownSource(document)).toThrow(
      "This link cannot be preserved as Markdown",
    );
    expect(document).toEqual(original);
  },
);
it("round-trips an untouched structured note exactly, including empty paragraphs", () => {
  const document: NoteDocument = {
    type: "doc",
    content: [
      {
        type: "heading",
        attrs: { level: 2 },
        content: [{ type: "text", text: "Heading" }],
      },
      { type: "paragraph" },
      {
        type: "paragraph",
        content: [
          { type: "text", text: "A bold note", marks: [{ type: "bold" }] },
        ],
      },
    ],
  };
  const source = createMarkdownSource(document);
  expect(parseMarkdownSource(source.text, source)).toEqual(document);
  expect(
    parseMarkdownSource(source.text + "\n\nAnother line", source).content,
  ).toContainEqual({
    type: "paragraph",
    content: [{ type: "text", text: "Another line" }],
  });
});
it("preserves original note references and refuses fabricated or foreign reference tokens", () => {
  const link = {
    type: "noteLink",
    attrs: {
      version: 1,
      target: {
        kind: "note",
        accountId: "11111111-1111-4111-8111-111111111111",
        libraryEpoch: "22222222-2222-4222-8222-222222222222",
        noteId: "target",
      },
    },
  };
  const document = {
    type: "doc",
    content: [{ type: "paragraph", content: [link] }],
  } as NoteDocument;
  const source = createMarkdownSource(document);
  expect(
    parseMarkdownSource(source.text + " text", source).content[0]?.content?.[0],
  ).toEqual(link);
  expect(() => parseMarkdownSource("[[note:unknown]]", source)).toThrow(
    "Unknown reference",
  );
  expect(() => parseMarkdownSource(source.text)).toThrow("Unknown reference");
});
it("preserves an initial horizontal rule and rejects content that the import codec would flatten", () => {
  expect(parseMarkdownSource("---\n\nText").content[0]?.type).toBe(
    "horizontalRule",
  );
  expect(() => parseMarkdownSource("![diagram](diagram.png)")).toThrow(
    "not supported",
  );
  expect(() => parseMarkdownSource("| A | B |\n| - | - |")).toThrow(
    "not supported",
  );
  expect(() =>
    createMarkdownSource({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Underline", marks: [{ type: "underline" }] },
          ],
        },
      ],
    }),
  ).toThrow("Keep using Rich");
});
