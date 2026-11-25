import { describe, expect, it } from "vitest";
import { exportMarkdown, parseMarkdown } from "../../src/transfer";
import type { Note, NoteDocument } from "../../src/domain/contracts";

const note = (document: NoteDocument): Note => ({
  id: "fixture",
  title: "Code marks",
  document,
  tags: [],
  createdAt: "2026-11-08T00:00:00Z",
  updatedAt: "2026-11-08T00:00:00Z",
  trashedAt: null,
  revision: 1,
});

type Mark = { type: string; attrs?: Record<string, unknown> };

const paragraph = (marks: Mark[]): NoteDocument => ({
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [{ type: "text", text: "value", marks }],
    },
  ],
});

const exportedBody = (document: NoteDocument): string =>
  exportMarkdown([note(document)])[0]!.content;

const reimportedMarks = (document: NoteDocument): string[] => {
  const exported = exportMarkdown([note(document)])[0]!;
  const parsed = parseMarkdown([
    { name: exported.filename, content: exported.content },
  ])[0]!;
  const nodes = parsed.document.content[0]!.content ?? [];
  return nodes
    .filter((node) => node.text === "value")
    .flatMap((node) => (node.marks ?? []).map((mark) => mark.type))
    .sort();
};

const bold: Mark = { type: "bold" };
const italic: Mark = { type: "italic" };
const strike: Mark = { type: "strike" };
const code: Mark = { type: "code" };
const link: Mark = { type: "link", attrs: { href: "https://example.test/a" } };

/**
 * The defect depended on mark order: the code span replaced the accumulated
 * text, so any emphasis or link applied BEFORE it was discarded. Each case is
 * asserted with the code mark last, which is the order that used to lose data,
 * and the same document with the code mark first is checked to produce the same
 * bytes.
 */
describe("Code spans keep the marks wrapped around them", () => {
  it("exports bold that wraps inline code, whichever order the marks arrive in", () => {
    const codeLast = exportedBody(paragraph([bold, code]));
    const codeFirst = exportedBody(paragraph([code, bold]));
    expect(codeLast).toContain("**` value `**");
    expect(codeFirst).toBe(codeLast);
  });

  it("exports a link that wraps inline code, whichever order the marks arrive in", () => {
    const codeLast = exportedBody(paragraph([link, code]));
    const codeFirst = exportedBody(paragraph([code, link]));
    expect(codeLast).toContain("[` value `](https://example.test/a)");
    expect(codeFirst).toBe(codeLast);
  });

  it("keeps code, bold and italic together in a stable nesting", () => {
    const codeLast = exportedBody(paragraph([bold, italic, code]));
    const codeFirst = exportedBody(paragraph([code, bold, italic]));
    expect(codeLast).toContain("***` value `***");
    expect(codeFirst).toBe(codeLast);
  });

  it("keeps both the link and the emphasis whatever the mark order", () => {
    // The nesting order is main's existing convention (link inside emphasis:
    // `**[`…`](url)**`); what this guards is that neither mark is dropped.
    // Before the fix, a code mark applied after them replaced the whole span.
    for (const marks of [
      [link, bold, code],
      [code, bold, link],
      [bold, code, link],
    ] as Mark[][]) {
      const body = exportedBody(paragraph(marks));
      expect(body).toContain("**");
      expect(body).toContain("](https://example.test/a)");
      expect(body).toContain("` value `");
    }
  });

  it("leaves a bare code span unchanged", () => {
    expect(exportedBody(paragraph([code]))).toContain("` value `");
  });

  it("round trips code with bold and with a link", () => {
    expect(reimportedMarks(paragraph([bold, code]))).toEqual(["bold", "code"]);
    expect(reimportedMarks(paragraph([link, code]))).toEqual(["code", "link"]);
  });
});
