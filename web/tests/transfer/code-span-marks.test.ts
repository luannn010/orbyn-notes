import { describe, expect, it } from "vitest";
import {
  exportMarkdown,
  parseMarkdown,
  renderMarkdownSnapshot,
} from "../../src/transfer";
import type { Note, NoteDocument, RichNode } from "../../src/domain/contracts";

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
  it.each([[[]], [[link]]])(
    "combines adjacent code nodes into a single literal span",
    (outer) => {
      const document: NoteDocument = {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "a", marks: [...outer, code] },
              { type: "text", text: "b", marks: [...outer, code] },
            ],
          },
        ],
      };
      const exported = exportMarkdown([note(document)])[0]!;
      const parsed = parseMarkdown([
        { name: exported.filename, content: exported.content },
      ])[0]!;
      const nodes = parsed.document.content[0]!.content!;
      expect(nodes.map((node) => node.text).join("")).toBe("ab");
      expect(
        nodes.every((node) => node.marks?.some((mark) => mark.type === "code")),
      ).toBe(true);
      if (outer.length)
        expect(
          nodes.every((node) =>
            node.marks?.some(
              (mark) =>
                mark.type === "link" &&
                mark.attrs?.href === "https://example.test/a",
            ),
          ),
        ).toBe(true);
    },
  );
  it("preserves bold across adjacent plain and code text", () => {
    const document: NoteDocument = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "a", marks: [bold] },
            { type: "text", text: "b", marks: [bold, code] },
          ],
        },
      ],
    };
    const exported = exportMarkdown([note(document)])[0]!;
    expect(exported.content).toContain("**a` b `**");
    const parsed = parseMarkdown([
      { name: exported.filename, content: exported.content },
    ])[0]!;
    const nodes = parsed.document.content[0]!.content!;
    expect(
      nodes.map((node) => [
        node.text,
        node.marks?.map((mark) => mark.type).sort(),
      ]),
    ).toEqual([
      ["a", ["bold"]],
      ["b", ["bold", "code"]],
    ]);
  });
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

  it("keeps a link outside emphasis, independent of arrival order", () => {
    const a = exportedBody(paragraph([link, bold, code]));
    const b = exportedBody(paragraph([code, bold, link]));
    const c = exportedBody(paragraph([bold, code, link]));
    expect(a).toContain("[**` value `**](https://example.test/a)");
    expect(b).toBe(a);
    expect(c).toBe(a);
  });

  it("leaves a bare code span unchanged", () => {
    expect(exportedBody(paragraph([code]))).toContain("` value `");
  });

  it("round trips code with bold and with a link", () => {
    expect(reimportedMarks(paragraph([bold, code]))).toEqual(["bold", "code"]);
    expect(reimportedMarks(paragraph([link, code]))).toEqual(["code", "link"]);
  });
});

// Compare semantic ranges: Markdown may combine adjacent text nodes on import.
const ranges = (nodes: RichNode[]) =>
  nodes.flatMap((node) =>
    (node.text ?? "").split("").map((text) => ({
      text,
      marks: (node.marks ?? [])
        .map((mark) =>
          mark.type === "link" ? `link:${mark.attrs?.href}` : mark.type,
        )
        .sort(),
    })),
  );
const textNode = (text: string, marks: Mark[] = []): RichNode => ({
  type: "text",
  text,
  marks,
});
it.each([[true, "\u00a0"], [false, "\u00a0"], [true, "\u0085"], [false, "\u0085"]])("round trips non-ASCII whitespace at an emphasis edge", (before, whitespace) => {
  const children = before
    ? [textNode(whitespace, [bold, link]), textNode("x", [bold, link, code])]
    : [textNode("x", [bold, link, code]), textNode(whitespace, [bold, link])];
  const file = exportMarkdown([note({ type: "doc", content: [{ type: "paragraph", content: children }] })])[0]!;
  const parsed = parseMarkdown([{ name: file.filename, content: file.content }])[0]!;
  expect(ranges(parsed.document.content[0]!.content ?? []), file.content).toEqual(ranges(children));
});
it.each([
  ["code then plain", [textNode("a", [bold, code]), textNode("b", [bold])]],
  [
    "partial overlap",
    [
      textNode("a", [bold]),
      textNode("b", [bold, italic, code]),
      textNode("c", [italic]),
    ],
  ],
  [
    "partial strike overlap",
    [
      textNode("a", [strike]),
      textNode("b", [strike, bold, code]),
      textNode("c", [bold]),
    ],
  ],
  [
    "partial overlap then plain",
    [textNode("a", [bold]), textNode("b", [bold, italic, code]), textNode("c")],
  ],
  [
    "partial code overlap",
    [
      textNode("a", [bold, code]),
      textNode("b", [bold, italic, code]),
      textNode("c", [italic, code]),
    ],
  ],
  [
    "backtick fragments",
    [textNode("a`", [bold, code]), textNode("``b", [code, bold])],
  ],
  [
    "href transition",
    [
      textNode("a", [bold, link]),
      textNode("b", [
        bold,
        code,
        { type: "link", attrs: { href: "https://example.test/b" } },
      ]),
      textNode("c", [bold]),
    ],
  ],
  [
    "mixed whitespace",
    [
      textNode(" plain ", [bold]),
      textNode(" code ", [code, bold]),
      textNode(" tail ", [bold]),
    ],
  ],
] satisfies [string, RichNode[]][])("round trips %s", (_, children) => {
  const document: NoteDocument = {
    type: "doc",
    content: [{ type: "paragraph", content: children }],
  };
  const file = exportMarkdown([note(document)])[0]!;
  const parsed = parseMarkdown([
    { name: file.filename, content: file.content },
  ])[0]!;
  // Edge whitespace of non-code emphasis is intentionally unstyled (PR172).
  const actual = ranges(parsed.document.content[0]!.content ?? []);
  const original = ranges(children);
  for (const point of [original[0], original.at(-1)])
    if (point?.text === " " && !point.marks.includes("code"))
      point.marks = point.marks.filter(
        (mark) => !["bold", "italic", "strike"].includes(mark),
      );
  expect(actual).toEqual(original);
});

it("retains style ranges across code transitions for every emphasis combination", () => {
  const styles = [bold, italic, strike];
  for (let left = 0; left < 8; left++)
    for (let middle = 0; middle < 8; middle++) {
      const selected = (mask: number) =>
        styles.filter((_, bit) => mask & (1 << bit));
      const children = [
        textNode("a", selected(left)),
        textNode("`b`", [...selected(middle), code]),
        textNode("c", selected(left ^ 7)),
      ];
      const file = exportMarkdown([
        note({
          type: "doc",
          content: [{ type: "paragraph", content: children }],
        }),
      ])[0]!;
      const parsed = parseMarkdown([
        { name: file.filename, content: file.content },
      ])[0]!;
      expect(
        ranges(parsed.document.content[0]!.content ?? []),
        file.content,
      ).toEqual(ranges(children));
    }
});

it.each([" ", "  ", "`", " ` "])(
  "retains literal code whitespace and fences: %j",
  (text) => {
    const children = [textNode(text, [bold, code])];
    const file = exportMarkdown([
      note({
        type: "doc",
        content: [{ type: "paragraph", content: children }],
      }),
    ])[0]!;
    const parsed = parseMarkdown([
      { name: file.filename, content: file.content },
    ])[0]!;
    expect(ranges(parsed.document.content[0]!.content ?? [])).toEqual(
      ranges(children),
    );
  },
);
it("retains mark order permutations and reference boundaries", () => {
  const permutations = (marks: Mark[]): Mark[][] =>
    marks.length
      ? marks.flatMap((mark, index) =>
          permutations(marks.filter((_, other) => index !== other)).map(
            (rest) => [mark, ...rest],
          ),
        )
      : [[]];
  const expected = exportedBody(paragraph([bold, italic, link, code]));
  for (const marks of permutations([bold, italic, link, code])) {
    expect(exportedBody(paragraph(marks))).toBe(expected);
    expect(reimportedMarks(paragraph(marks))).toEqual([
      "bold",
      "code",
      "italic",
      "link",
    ]);
  }
  const reference: RichNode = {
    type: "noteLink",
    attrs: { version: 1, target: {} },
  };
  const left = textNode("a", [bold, code, link]),
    right = textNode("b", [bold, code]);
  const seen: RichNode[] = [];
  const file = renderMarkdownSnapshot(
    [
      note({
        type: "doc",
        content: [{ type: "paragraph", content: [left, reference, right] }],
      }),
    ],
    (node) => {
      seen.push(node);
      return "[Ref](https://example.test/ref)";
    },
  )[0]!;
  const parsed = parseMarkdown([
    { name: file.filename, content: file.content },
  ])[0]!;
  expect(seen).toEqual([reference]);
  expect(ranges(parsed.document.content[0]!.content ?? [])).toEqual(
    ranges([
      left,
      textNode("Ref", [
        { type: "link", attrs: { href: "https://example.test/ref" } },
      ]),
      right,
    ]),
  );
});

const edgeWhitespaceCases = [
  ["bold", [bold]],
  ["italic", [italic]],
  ["strike", [strike]],
  ["link", [link]],
  ["linked bold", [link, bold]],
] satisfies [string, Mark[]][];
describe.each(edgeWhitespaceCases)(
  "code beside whitespace in a shared %s run",
  (_, outer) => {
    it.each(["  ", "\t\t"])(
      "keeps %j at paragraph and hard-break edges",
      (whitespace) => {
        for (const beforeCode of [false, true])
          for (const hardBreak of [false, true]) {
            const literal = textNode("x", [...outer, code]);
            const edge = textNode(whitespace, outer);
            const children = beforeCode ? [edge, literal] : [literal, edge];
            const whitespaceMarks = outer.filter(
              (mark) => mark.type === "link",
            );
            const expected = beforeCode
              ? [textNode(whitespace, whitespaceMarks), literal]
              : [literal, textNode(whitespace, whitespaceMarks)];
            if (hardBreak) {
              if (beforeCode) {
                children.unshift(textNode("before"), { type: "hardBreak" });
                expected.unshift(textNode("before"), { type: "hardBreak" });
              } else {
                children.push({ type: "hardBreak" }, textNode("after"));
                expected.push({ type: "hardBreak" }, textNode("after"));
              }
            }
            const file = exportMarkdown([
              note({
                type: "doc",
                content: [{ type: "paragraph", content: children }],
              }),
            ])[0]!;
            const parsed = parseMarkdown([
              { name: file.filename, content: file.content },
            ])[0]!;
            const actual = parsed.document.content[0]!.content ?? [];
            const withBreaks = (nodes: RichNode[]) =>
              nodes.flatMap((node) =>
                node.type === "hardBreak" ? [{ kind: "hardBreak" }] : ranges([node]).map((range) => ({ kind: "text", ...range })),
              );
            expect(parsed.document.content).toHaveLength(1);
            expect(withBreaks(actual), file.content).toEqual(
              withBreaks(expected),
            );
          }
      },
    );
  },
);
