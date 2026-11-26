import { describe, expect, it } from "vitest";
import type { Note } from "../../src/domain/contracts";
import { exportMarkdown, parseMarkdown } from "../../src/transfer";

describe("Markdown metadata and empty tasks", () => {
  it.each([
    ["- `[x]`", [{ type: "text", text: "[x]", marks: [{ type: "code" }] }]],
    ["- **[x]**", [{ type: "text", text: "[x]", marks: [{ type: "bold" }] }]],
    ["- \\[x]", [{ type: "text", text: "[x]" }]],
    [
      "- [x]**label**",
      [
        { type: "text", text: "[x]" },
        { type: "text", text: "label", marks: [{ type: "bold" }] },
      ],
    ],
  ])(
    "keeps literal checkbox text as an ordinary bullet: %s",
    (content, expected) => {
      const result = parseMarkdown([
        { name: "literal.md", content: content as string },
      ])[0]!;
      expect(result.document.content[0]!.type).toBe("bulletList");
      expect(
        result.document.content[0]!.content![0]!.content![0]!.content,
      ).toEqual(expected);
    },
  );

  it("recognizes a source task prefix before formatted content and preserves empty tasks", () => {
    const result = parseMarkdown([
      { name: "tasks.md", content: "- [x] **label**\n- [ ]" },
    ])[0]!;
    expect(result.document.content[0]!.type).toBe("taskList");
    expect(
      result.document.content[0]!.content![0]!.content![0]!.content,
    ).toEqual([{ type: "text", text: "label", marks: [{ type: "bold" }] }]);
    expect(
      result.document.content[0]!.content![1]!.content![0]!.content,
    ).toEqual([]);
  });

  it("accepts empty frontmatter and retains the body", () => {
    const [result] = parseMarkdown([
      { name: "empty.md", content: "---\n---\nbody" },
    ]);
    expect(result!.title).toBe("empty");
    expect(result!.document.content[0]!.content![0]!.text).toBe("body");
  });

  it.each(["---\n---", '---\ntitle: "Named"\n---'])(
    "accepts a closing delimiter at end of file: %s",
    (content) => {
      expect(() => parseMarkdown([{ name: "eof.md", content }])).not.toThrow();
    },
  );

  it.each([
    "---\ntitle: plain YAML\n---\nbody",
    "---\nunknown: value\n---\nbody",
    "---\ntitle: 123\n---\nbody",
    "---\ntags: [1]\n---\nbody",
    '---\ntitle: "unclosed"',
  ])("names the file for invalid frontmatter: %s", (content) => {
    expect(() => parseMarkdown([{ name: "bad metadata.md", content }])).toThrow(
      /invalid_frontmatter:.*bad metadata\.md/,
    );
  });

  it("round trips checked and unchecked empty tasks without empty text nodes", () => {
    const [imported] = parseMarkdown([
      { name: "tasks.md", content: "- [ ]\n- [x]" },
    ]);
    const tasks = imported!.document.content[0]!;
    expect(tasks.type).toBe("taskList");
    expect(tasks.content).toEqual([
      {
        type: "taskItem",
        attrs: { checked: false },
        content: [{ type: "paragraph", content: [] }],
      },
      {
        type: "taskItem",
        attrs: { checked: true },
        content: [{ type: "paragraph", content: [] }],
      },
    ]);
    const note: Note = {
      ...imported!,
      id: "fixture",
      revision: 1,
      createdAt: "2026-01-01",
      updatedAt: "2026-01-01",
      trashedAt: null,
    };
    const exported = exportMarkdown([note])[0]!;
    expect(
      parseMarkdown([
        { name: exported.filename, content: exported.content },
      ])[0],
    ).toEqual(imported);
  });
});
