// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { Note, RichNode } from "../../src/domain/contracts";
import {
  exportMarkdown,
  parseMarkdown,
  renderMarkdownSnapshot,
} from "../../src/transfer";
import {
  NOTE_EXPORT_LIMITS,
  renderNoteExport,
} from "../../src/transfer/noteLinks";

const paragraph = (text = ""): RichNode => ({
  type: "paragraph",
  content: text ? [{ type: "text", text }] : [],
});
const note = (content: RichNode[]): Note => ({
  id: "loss-fixture",
  title: "Loss fixture",
  tags: [],
  revision: 1,
  createdAt: "2026-01-01",
  updatedAt: "2026-01-01",
  trashedAt: null,
  document: { type: "doc", content },
});
const projection = {
  accountId: "11111111-1111-4111-8111-111111111111",
  token: { epoch: "22222222-2222-4222-8222-222222222222", revision: 1 },
  references: [],
};
const list = (type: string): RichNode => ({
  type,
  ...(type === "orderedList" ? { attrs: { start: 1 } } : {}),
  content: [
    {
      type: type === "taskList" ? "taskItem" : "listItem",
      content: [paragraph("Item")],
    },
  ],
});
const losses: Array<[string, RichNode[]]> = [
  [
    "underline",
    [
      {
        type: "paragraph",
        content: [
          { type: "text", text: "Underlined", marks: [{ type: "underline" }] },
        ],
      },
    ],
  ],
  ["empty paragraphs", [paragraph("Before"), paragraph(), paragraph("After")]],
  ...["bulletList", "orderedList", "taskList"].map(
    (type): [string, RichNode[]] => [
      "adjacent lists",
      [list(type), list(type)],
    ],
  ),
];

describe("Markdown loss reporting", () => {
  it.each([
    "![alt](https://example.test/image.png)",
    "![](https://example.test/empty.png)",
    "[![nested](https://example.test/image.png)](https://example.test)",
  ])("rejects image import before dropping its URL: %s", (content) => {
    expect(() => parseMarkdown([{ name: "image.md", content }])).toThrow(
      /unsupported_image:.*image\.md/,
    );
  });

  it.each(losses)("rejects direct export losing %s", (reason, content) => {
    expect(() => exportMarkdown([note(content)])).toThrow(
      new RegExp(`unsupported_markdown_export:.*${reason}`),
    );
  });

  it.each(losses)(
    "reports %s in the authorized bundle while retaining its exact document",
    (reason, content) => {
      const original = note(content);
      const result = renderNoteExport([original], projection);
      const readme = result.files.find(
        (file) => file.filename === "README.txt",
      )!.content;
      expect(
        result.warnings.some(
          (warning) =>
            warning.includes(reason) && warning.includes("notes.json"),
        ),
      ).toBe(true);
      expect(readme).toContain(reason);
      expect(
        JSON.parse(
          result.files.find((file) => file.filename === "notes.json")!.content,
        ).notes,
      ).toEqual([original]);
      expect(result.files.some((file) => file.filename.endsWith(".md"))).toBe(
        true,
      );
    },
  );

  it("retains a single empty document and an empty task as usable Markdown", () => {
    for (const content of [
      [paragraph()],
      [
        {
          type: "taskList",
          content: [
            {
              type: "taskItem",
              attrs: { checked: false },
              content: [paragraph()],
            },
          ],
        },
      ],
    ]) {
      const original = note(content);
      const file = exportMarkdown([original])[0]!;
      expect(
        parseMarkdown([{ name: file.filename, content: file.content }])[0]!
          .document,
      ).toEqual(original.document);
    }
  });

  it("exports imported paragraph soft breaks as readable lines", () => {
    const imported = parseMarkdown([
      { name: "lines.md", content: "First\nSecond\nThird" },
    ])[0]!;
    const file = exportMarkdown([{ ...note([]), ...imported }])[0]!;
    expect(file.content).toContain("First\nSecond\nThird");
    expect(
      parseMarkdown([{ name: file.filename, content: file.content }])[0]!
        .document,
    ).toEqual(imported.document);
  });

  it("retains literal newlines inside a heading instead of creating another block", () => {
    const original = note([
      {
        type: "heading",
        attrs: { level: 2 },
        content: [{ type: "text", text: "First\nSecond" }],
      },
    ]);
    const file = exportMarkdown([original])[0]!;
    expect(
      parseMarkdown([{ name: file.filename, content: file.content }])[0]!
        .document,
    ).toEqual(original.document);
  });

  it.each([
    "a\nb",
    "\na\n",
    "a\n\nb",
    "a\n- bullet\n1. ordered\n===\n# heading",
    "a  \n    b",
    "\n\n",
    "a\r\nb",
  ])("preserves raw line text and line-start hazards: %j", (text) => {
    const file = exportMarkdown([note([paragraph(text)])])[0]!;
    const imported = parseMarkdown([
      { name: file.filename, content: file.content },
    ])[0]!;
    expect(imported.document.content).toHaveLength(1);
    expect(
      imported.document.content[0]!.content!.map(
        (node) => node.text ?? "",
      ).join(""),
    ).toBe(text);
  });

  it("admits indentation of new body line breaks before rendering nested output", () => {
    let document: RichNode[] = [paragraph(`${"a\n".repeat(1000)}z`)];
    for (let depth = 0; depth < 10; depth++)
      document = [{ type: "blockquote", content: document }];
    let admitted = 0;
    const files = renderMarkdownSnapshot([note(document)], undefined, {
      admit: (bytes) => {
        admitted = bytes;
      },
      referenceBound: () => 0,
    });
    expect(
      new TextEncoder().encode(files[0]!.content).length,
    ).toBeLessThanOrEqual(admitted);
  });

  it("keeps warning detection within the existing two renderer visit allowances", () => {
    const original = note(losses[0]![1]); // doc, paragraph, text: three nodes
    expect(() =>
      renderNoteExport([original], {
        ...projection,
        consumedWork: {
          utf8Units: 0,
          nodeVisits: NOTE_EXPORT_LIMITS.nodeVisits - 9,
        },
      }),
    ).not.toThrow();
    expect(() =>
      renderNoteExport([original], {
        ...projection,
        consumedWork: {
          utf8Units: 0,
          nodeVisits: NOTE_EXPORT_LIMITS.nodeVisits - 8,
        },
      }),
    ).toThrow(expect.objectContaining({ code: "note_link_limit" }));
  });
});
