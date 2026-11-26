import { describe, expect, it } from "vitest";
import type { Note, RichNode } from "../../src/domain/contracts";
import { exportMarkdown, parseMarkdown } from "../../src/transfer";

let sequence = 0;

function importNote(content: string): Note {
  const imported = parseMarkdown([
    { name: `source-${++sequence}.md`, content },
  ])[0]!;
  return {
    ...imported,
    id: `fixture-${sequence}`,
    createdAt: "2026-11-25T00:00:00Z",
    updatedAt: "2026-11-25T00:00:00Z",
    revision: 1,
    trashedAt: null,
  };
}

function roundTrip(content: string) {
  const note = importNote(content);
  const exported = exportMarkdown([note])[0]!;
  const reimported = parseMarkdown([
    { name: exported.filename, content: exported.content },
  ])[0]!;
  return { note, exported, reimported };
}

function textOf(nodes: readonly RichNode[] | undefined): string {
  return (nodes ?? [])
    .map((node) => (node.type === "text" ? (node.text ?? "") : textOf(node.content)))
    .join("");
}

function typesOf(nodes: readonly RichNode[] | undefined): string[] {
  return (nodes ?? []).map((node) => node.type);
}

describe("Markdown export of nested lists under task items", () => {
  it("keeps a nested task list a list through an export and re-import", () => {
    const { exported, reimported } = roundTrip("- [ ] t\n  - [x] n\n");

    expect(exported.content).toContain("- [ ] t");
    expect(JSON.stringify(reimported.document)).not.toContain("codeBlock");
    expect(typesOf(reimported.document.content)).toEqual(["taskList"]);

    const outer = reimported.document.content[0]!;
    const item = outer.content?.[0];
    expect(item?.type).toBe("taskItem");
    expect(item?.attrs?.checked).toBe(false);
    expect(typesOf(item?.content)).toEqual(["paragraph", "taskList"]);
    expect(textOf(item?.content)).toBe("tn");
    expect(item?.content?.[1]?.content?.[0]?.attrs?.checked).toBe(true);
  });

  it("keeps a nested bullet list a list through an export and re-import", () => {
    const { reimported } = roundTrip("- [ ] parent\n  - child\n");

    expect(JSON.stringify(reimported.document)).not.toContain("codeBlock");
    const outer = reimported.document.content[0]!;
    const item = outer.content?.[0];
    expect(outer.type).toBe("taskList");
    expect(item?.type).toBe("taskItem");
    expect(typesOf(item?.content)).toEqual(["paragraph", "bulletList"]);
    expect(textOf(item?.content)).toBe("parentchild");
  });

  it("nests lists under ordered items that use a two-digit marker", () => {
    const { exported, reimported } = roundTrip(
      "9. nine\n   - child nine\n10. ten\n    - child ten\n",
    );

    expect(exported.content).toContain("10. ten");
    expect(exported.content).toContain("\n    - child ten");
    expect(JSON.stringify(reimported.document)).not.toContain("codeBlock");

    const list = reimported.document.content[0]!;
    expect(list.type).toBe("orderedList");
    expect(typesOf(list.content)).toEqual(["listItem", "listItem"]);
    expect(typesOf(list.content?.[1]?.content)).toEqual(["paragraph", "bulletList"]);
    expect(textOf(list.content)).toBe("ninechild ninetenchild ten");
  });

  it("does not regress a nested list under a plain bullet", () => {
    const { exported, reimported } = roundTrip("- parent\n  - child\n");

    expect(exported.content).toContain("\n  - child");
    expect(JSON.stringify(reimported.document)).not.toContain("codeBlock");
    const list = reimported.document.content[0]!;
    expect(list.type).toBe("bulletList");
    expect(typesOf(list.content?.[0]?.content)).toEqual(["paragraph", "bulletList"]);
    expect(textOf(list.content)).toBe("parentchild");
  });
});
