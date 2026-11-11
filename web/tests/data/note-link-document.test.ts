import { describe, expect, it } from "vitest";
import {
  inspectNoteDocument,
  inspectNotes,
  safeHref,
  validateDocument,
  validateInput,
  validateNoteDocument,
  validateNoteInput,
  validateNotes,
} from "../../src/domain/validation";

const target = {
  kind: "note",
  accountId: "11111111-1111-4111-8111-111111111111",
  libraryEpoch: "22222222-2222-4222-8222-222222222222",
  noteId: "opaque / ID, 🧪",
} as const;
function document() {
  return {
    type: "doc" as const,
    content: [
      {
        type: "paragraph",
        content: [
          { type: "text", text: "Before " },
          { type: "noteLink", attrs: { version: 1, target: { ...target } } },
          { type: "text", text: " after" },
        ],
      },
    ],
  };
}
const input = () => ({
  title: "A note",
  document: document(),
  tags: ["exact,tag"],
});
const note = () => ({
  id: "legacy source ID",
  ...input(),
  revision: 1,
  createdAt: "2026-11-11T00:00:00.000Z",
  updatedAt: "2026-11-11T00:00:00.000Z",
  trashedAt: null,
});

describe("Notes-only reference document admission", () => {
  it("keeps generic/Journal and legacy defaults strict while Notes opts in", () => {
    expect(() => validateDocument(document())).toThrow(
      /Unsupported document node/,
    );
    expect(() => validateInput(input())).toThrow();
    expect(() => validateNotes([note()])).toThrow();
    expect(validateNoteDocument(document())).toEqual(document());
    expect(validateNoteInput(input())).toEqual(input());
    expect(validateNotes([note()], "notes")).toEqual([note()]);
    expect(() => validateNotes([note()], "plain")).toThrow();
    expect(safeHref("orbyn-notes://note/v1/token")).toBe(false);
  });

  it("counts the actual single validation pass and returns an immutable-input snapshot", () => {
    const value = document();
    const result = inspectNoteDocument(value, "notes");
    expect(result.nodeVisits).toBe(5);
    expect(result.jsonUnits).toBe(JSON.stringify(value).length);
    expect(result.document).toEqual(value);
    value.content[0]!.content[0]!.text = "Changed later";
    expect(result.document).not.toEqual(value);
    expect(() => inspectNoteDocument(document(), "plain")).toThrow();
    expect(inspectNotes([note()], "notes")).toEqual([
      {
        note: note(),
        nodeVisits: 5,
        jsonUnits: JSON.stringify(note().document).length,
      },
    ]);
  });

  it("rejects inherited identity substitution before returning a document snapshot", () => {
    const inherited = Object.assign(Object.create({ noteId: "inherited" }), {
      kind: target.kind,
      accountId: target.accountId,
      libraryEpoch: target.libraryEpoch,
      title: "Cached title must never survive admission",
    });
    const withTarget = (value: unknown) => ({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "noteLink", attrs: { version: 1, target: value } }],
        },
      ],
    });
    expect(() => validateNoteDocument(withTarget(inherited))).toThrow();
    const own = Object.assign(Object.create(null), target);
    expect(validateNoteDocument(withTarget(own))).toEqual(withTarget(target));
  });

  it.each([
    { type: "noteLink", attrs: { version: 2, target } },
    { type: "noteLink", attrs: { version: 1, target, title: "Cached title" } },
    {
      type: "noteLink",
      attrs: { version: 1, target: { ...target, title: "Hidden title" } },
    },
    {
      type: "noteLink",
      attrs: { version: 1, target: { ...target, kind: "task" } },
    },
    {
      type: "noteLink",
      attrs: { version: 1, target: { ...target, accountId: "invalid" } },
    },
    {
      type: "noteLink",
      attrs: { version: 1, target: { ...target, libraryEpoch: "invalid" } },
    },
    {
      type: "noteLink",
      attrs: { version: 1, target: { ...target, noteId: 4 } },
    },
    { type: "noteLink", attrs: { version: 1, target }, content: [] },
    { type: "noteLink", attrs: { version: 1, target }, text: "Cached text" },
    {
      type: "noteLink",
      attrs: { version: 1, target },
      marks: [{ type: "bold" }],
    },
    {
      type: "noteLink",
      attrs: { version: 1, target },
      href: "https://example.test",
    },
  ])(
    "rejects malformed/foreign-kind/content-bearing reference nodes: %j",
    (link) => {
      expect(() =>
        validateNoteDocument({
          type: "doc",
          content: [{ type: "paragraph", content: [link] }],
        }),
      ).toThrow();
    },
  );

  it("retains valid opaque IDs in documents even if a portable token cannot encode them", () => {
    for (const noteId of ["", "\ud800", "x".repeat(5000)]) {
      const value = {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "noteLink",
                attrs: { version: 1, target: { ...target, noteId } },
              },
            ],
          },
        ],
      };
      expect(validateNoteDocument(value)).toEqual(value);
    }
  });

  it.each(["doc", "codeBlock", "listItem"])(
    "rejects a reference in non-inline %s content",
    (parent) => {
      const link = { type: "noteLink", attrs: { version: 1, target } };
      const value =
        parent === "doc"
          ? { type: "doc", content: [link] }
          : { type: "doc", content: [{ type: parent, content: [link] }] };
      expect(() => validateNoteDocument(value)).toThrow();
    },
  );

  it.each(["paragraph", "codeBlock"])(
    "rejects a reference hidden through an invalid %s ancestor",
    (parent) => {
      const value = {
        type: "doc",
        content: [
          {
            type: parent,
            content: [
              {
                type: "paragraph",
                content: [{ type: "noteLink", attrs: { version: 1, target } }],
              },
            ],
          },
        ],
      };
      expect(() => validateNoteDocument(value)).toThrow();
    },
  );

  it("enforces the reference count alongside the existing document/node/depth bounds", () => {
    const link = { type: "noteLink", attrs: { version: 1, target } };
    const value = (count: number) => ({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: Array.from({ length: count }, () => structuredClone(link)),
        },
      ],
    });
    expect(validateNoteDocument(value(1000))).toEqual(value(1000));
    expect(() => validateNoteDocument(value(1001))).toThrow();
    expect(() =>
      validateNoteDocument({
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "x".repeat(1_000_001) }],
          },
        ],
      }),
    ).toThrow();
  });
});
