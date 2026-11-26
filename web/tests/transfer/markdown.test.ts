import { describe, expect, it } from "vitest";
import { exportMarkdown, parseMarkdown } from "../../src/transfer";
import type { Note, NoteDocument } from "../../src/domain/contracts";

const note = (document: NoteDocument): Note => ({
  id: "fixture",
  title: "Edge marks",
  document,
  tags: [],
  createdAt: "2026-11-08T00:00:00Z",
  updatedAt: "2026-11-08T00:00:00Z",
  trashedAt: null,
  revision: 1,
});
describe("Markdown transfer boundary", () => {
  it("keeps formatting and text when paragraphs start or end with a mark", () => {
    const result = parseMarkdown([{ name: "marks.md", content: "**Bold** and *italic* then ~~strike~~" }])[0]!;
    const nodes = result.document.content[0]!.content!;
    expect(nodes.map(n => n.text ?? "").join("")).toBe("Bold and italic then strike");
    expect(nodes.filter(n => n.text).map(n => [n.text, n.marks?.map(m => m.type) ?? []])).toEqual([
      ["Bold", ["bold"]], [" and ", []], ["italic", ["italic"]], [" then ", []], ["strike", ["strike"]],
    ]);
  });
  it("keeps bold when the marked run ends with a space", () => {
    const exported = exportMarkdown([
      note({
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "hello ", marks: [{ type: "bold" }] },
              { type: "text", text: "world" },
            ],
          },
        ],
      }),
    ])[0]!;
    expect(exported.content).toContain("**hello** world");
    const reimported = parseMarkdown([
      { name: exported.filename, content: exported.content },
    ])[0]!;
    const nodes = reimported.document.content[0]!.content!;
    expect(nodes.map((n) => n.text ?? "").join("")).toBe("hello world");
    expect(
      nodes
        .filter((n) => n.text)
        .map((n) => [n.text, n.marks?.map((m) => m.type) ?? []]),
    ).toEqual([
      ["hello", ["bold"]],
      [" world", []],
    ]);
  });
  it("keeps italic when the marked run ends with a space", () => {
    const exported = exportMarkdown([
      note({
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "a" },
              { type: "text", text: "lead ", marks: [{ type: "italic" }] },
              { type: "text", text: "b" },
            ],
          },
        ],
      }),
    ])[0]!;
    expect(exported.content).toContain("a*lead* b");
    const reimported = parseMarkdown([
      { name: exported.filename, content: exported.content },
    ])[0]!;
    expect(
      reimported.document.content[0]!.content!.filter((n) => n.text).map((n) => [
        n.text,
        n.marks?.map((m) => m.type) ?? [],
      ]),
    ).toEqual([
      ["a", []],
      ["lead", ["italic"]],
      [" b", []],
    ]);
  });
  it("keeps strike when the marked run starts with a space", () => {
    const exported = exportMarkdown([
      note({
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "a" },
              { type: "text", text: " tail", marks: [{ type: "strike" }] },
              { type: "text", text: "b" },
            ],
          },
        ],
      }),
    ])[0]!;
    expect(exported.content).toContain("a ~~tail~~b");
  });
  it("still encodes whitespace at the paragraph edge of a marked run", () => {
    const exported = exportMarkdown([
      note({
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: " bold ", marks: [{ type: "bold" }] },
            ],
          },
        ],
      }),
    ])[0]!;
    expect(exported.content).toContain("&#32;**bold**&#32;");
  });
  it.each([
    { name: "plain", before: { type: "text", text: "hello " }, after: { type: "text", text: " world" } },
    { name: "marked", before: { type: "text", text: "hello ", marks: [{ type: "bold" }] }, after: { type: "text", text: " world", marks: [{ type: "italic" }] } },
    { name: "whitespace-only", before: { type: "text", text: " " }, after: { type: "text", text: " " } },
  ])("preserves $name whitespace beside hard breaks", ({ before, after }) => {
    const exported = exportMarkdown([note({
      type: "doc", content: [{ type: "paragraph", content: [
        { type: "text", text: "start " }, before, { type: "hardBreak" }, after,
        { type: "text", text: " end" },
      ] }],
    })])[0]!;
    const imported = parseMarkdown([{ name: exported.filename, content: exported.content }])[0]!;
    const nodes = imported.document.content[0]!.content!;
    expect(nodes.map((n) => n.type === "hardBreak" ? "\n" : n.text ?? "").join(""))
      .toBe(`start ${before.text}\n${after.text} end`);
    if (before.marks) {
      expect(nodes.find((n) => n.text === "hello")?.marks).toEqual(before.marks);
      expect(nodes.find((n) => n.text === "world")?.marks).toEqual(after.marks);
    }
    expect(exported.content).toContain("start ");
    expect(exported.content).toContain(" end");
  });
  it("rejects unsupported tables with a useful error before any import", () => {
    expect(() => parseMarkdown([{ name: "table.md", content: "| Name | Value |\n| --- | --- |\n| secret | retained |" }])).toThrow("unsupported_table");
  });
  it("identifies an unsupported table in a mixed batch without altering other files", () => {
    const files = [
      { name: "plain.md", content: "plain" },
      { name: "table.md", content: "| A | B |\n|---|---|\n| X | Y |" },
    ];
    const original = structuredClone(files);
    expect(() => parseMarkdown(files)).toThrow(
      /unsupported_table:.*table\.md.*Convert the table to text.*Nothing was imported/s,
    );
    expect(files).toEqual(original);
    expect(
      parseMarkdown([files[0]!])[0]?.document.content[0]?.content?.[0]?.text,
    ).toBe("plain");
  });
  it("preserves ordinary list items alongside tasks without turning them into checkboxes", () => {
    const result = parseMarkdown([{ name: "mixed.md", content: "- Plain\n- [x] Done\n- Other\n- [ ] Next" }])[0]!;
    expect(result.document.content.map(n => n.type)).toEqual(["bulletList", "taskList", "bulletList", "taskList"]);
    expect(result.document.content.map(n => n.content?.[0]?.attrs?.checked ?? null)).toEqual([null, true, null, false]);
  });
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
