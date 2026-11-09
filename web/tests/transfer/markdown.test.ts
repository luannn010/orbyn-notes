import { describe, expect, it } from "vitest";
import { exportMarkdown, parseMarkdown } from "../../src/transfer";
import type { Note } from "../../src/domain/contracts";
describe("Markdown transfer boundary", () => {
  it("round trips title, tags, paragraphs, headings, ordered lists, tasks and links", () => {
    const source =
      '---\ntitle: "A safe title"\ntags: ["work", "a:b"]\n---\n\n# Heading\n\nA **bold** paragraph and [link](https://example.test).\n\n3. Third\n4. Fourth\n\n- [x] Done\n- [ ] Next\n';
    const imported = parseMarkdown([
      { name: "source.md", content: source },
    ])[0]!;
    const note: Note = {
      ...imported,
      id: "fixture",
      createdAt: "2026-11-08T00:00:00Z",
      updatedAt: "2026-11-08T00:00:00Z",
      revision: 1,
      trashedAt: null,
    };
    const exported = exportMarkdown([note])[0]!;
    expect(
      parseMarkdown([
        { name: exported.filename, content: exported.content },
      ])[0],
    ).toEqual(imported);
  });
  it("treats HTML and javascript links as inert text", () => {
    const result = parseMarkdown([
      {
        name: "unsafe.md",
        content: "<script>alert(1)</script>\n\n[bad](javascript:alert(1))",
      },
    ])[0]!;
    expect(JSON.stringify(result.document)).not.toContain('"type":"link"');
    expect(JSON.stringify(result.document)).toContain("<script>");
  });
  it("rejects malformed metadata, dangerous export links, huge files and binary files", () => {
    expect(() =>
      parseMarkdown([
        { name: "a.md", content: "---\ntags: !!js/function test\n---\n" },
      ]),
    ).toThrow("invalid_frontmatter");
    expect(() =>
      parseMarkdown([{ name: "a.md", content: "x".repeat(2000001) }]),
    ).toThrow("file_too_large");
    expect(() => parseMarkdown([{ name: "a.md", content: "x\0x" }])).toThrow(
      "invalid_file",
    );
    const bad = {
      title: "x",
      tags: [],
      document: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: "x",
                marks: [
                  { type: "link", attrs: { href: "javascript:alert(1)" } },
                ],
              },
            ],
          },
        ],
      },
    } as unknown as Note;
    expect(() => exportMarkdown([bad])).toThrow("unsafe");
  });
  it("validates the whole batch without mutating originals", () => {
    const files = [
      { name: "first.md", content: "First" },
      { name: "bad.bin", content: "bad" },
    ];
    const original = structuredClone(files);
    expect(() => parseMarkdown(files)).toThrow();
    expect(files).toEqual(original);
  });
});

it.each([
  "- literal bullet",
  "+ literal bullet",
  "1. literal ordered",
  "1) literal ordered",
  "---",
  "===",
  "# literal heading",
  "> literal quote",
  "```literal fence",
  "~~~literal fence",
  "[literal](https://example.test)",
  "    literal indentation",
  "literal &copy; entity",
  "a\n\n- literal continuation",
])("preserves literal paragraph text through Markdown export: %s", (text) => {
  const note: Note = {
    id: "literal",
    title: "Literal",
    tags: [],
    createdAt: "2026-11-08T00:00:00Z",
    updatedAt: "2026-11-08T00:00:00Z",
    revision: 1,
    trashedAt: null,
    document: {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text }] }],
    },
  };
  const file = exportMarkdown([note])[0]!;
  const result = parseMarkdown([
    { name: file.filename, content: file.content },
  ])[0]!;
  expect(result.document.content).toHaveLength(1);
  expect(result.document.content[0]?.type).toBe("paragraph");
  expect(
    result.document.content[0]?.content?.map((n) => n.text ?? "").join(""),
  ).toBe(text);
});
