import { expect, it, vi } from "vitest";
import { getSchema } from "@tiptap/core";
import { Transform } from "@tiptap/pm/transform";
import type { Node as PMNode } from "@tiptap/pm/model";
import type { NoteDocument } from "../../src/domain/contracts";
import {
  createNoteExtensions,
  createNoteSchema,
} from "../../src/editor/schema";
import {
  captureSourceSelection,
  canonicalSourceDocument,
  mapSourcePassage,
  verifySourceEdit,
} from "../../src/study/sourceCodec";

const target = {
  kind: "note",
  accountId: "11111111-1111-4111-8111-111111111111",
  libraryEpoch: "22222222-2222-4222-8222-222222222222",
  noteId: "opaque target",
} as const;
const json = (node: PMNode) => node.toJSON() as NoteDocument;
function fixture() {
  const schema = createNoteSchema();
  const chip = () =>
    schema.nodes.noteLink!.create({ version: 1, target: { ...target } });
  const paragraph = (content: PMNode[]) =>
    schema.nodes.doc!.create(
      null,
      schema.nodes.paragraph!.create(null, content),
    );
  return { schema, chip, paragraph };
}

it("uses the same identity-atom schema with or without a browser NodeView", () => {
  const renderer = vi.fn(() => {
    throw new Error("NodeView must not run in headless schema construction");
  });
  const base = createNoteSchema();
  const viewed = getSchema(
    createNoteExtensions({ noteLinkNodeView: renderer }),
  );
  const document = {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [{ type: "noteLink", attrs: { version: 1, target } }],
      },
    ],
  };
  for (const schema of [base, viewed]) {
    const node = schema.nodeFromJSON(document);
    node.check();
    expect(node.toJSON()).toEqual(document);
    const chip = node.firstChild!.firstChild!;
    expect(chip.isInline).toBe(true);
    expect(chip.isAtom).toBe(true);
    expect(chip.nodeSize).toBe(1);
    expect(chip.type.spec.parseDOM).toEqual([]);
    const html = chip.type.spec.toDOM!(chip);
    expect(JSON.stringify(html)).not.toContain("opaque target");
    expect(JSON.stringify(html)).not.toContain(target.accountId);
    expect(JSON.stringify(html)).toContain("Note reference");
  }
  expect(renderer).not.toHaveBeenCalled();
});

it("requires a typed target and rejects malformed intermediate target attributes", () => {
  const { schema, chip, paragraph } = fixture();
  expect(() => schema.nodes.noteLink!.createChecked({ version: 1 })).toThrow();
  const before = paragraph([chip(), schema.text(" chosen passage")]);
  expect(() =>
    new Transform(before).setNodeAttribute(1, "target", {
      ...target,
      kind: "task",
    }),
  ).toThrow();
  expect(() =>
    verifySourceEdit(json(before), json(before), [
      {
        stepType: "attr",
        pos: 1,
        attr: "target",
        value: { ...target, kind: "task" },
      },
      { stepType: "attr", pos: 1, attr: "target", value: { ...target } },
    ]),
  ).toThrow();
});

it("bounds exact Cloze context at adjacent real chips without replacing literal text", () => {
  const { schema, chip, paragraph } = fixture();
  const before = "middle \ufffc ";
  const doc = paragraph([
    schema.text("unrelated left"),
    chip(),
    schema.text(`${before}chosen tail`),
    chip(),
    schema.text("unrelated right"),
  ]);
  let start = 0;
  doc.descendants((node, pos) => {
    if (node.isText && node.text!.startsWith(before))
      start = pos + before.length;
  });
  const selection = captureSourceSelection(
    json(doc),
    start,
    start + "chosen".length,
  );
  expect(selection.passage.quote).toBe("chosen");
  expect(selection.context).toEqual({
    text: `${before}chosen tail`,
    selectionFrom: before.length,
    selectionTo: before.length + "chosen".length,
  });
  expect(() =>
    captureSourceSelection(json(doc), 1, doc.content.size - 1),
  ).toThrow();
  expect(canonicalSourceDocument(json(doc)).document).toEqual(json(doc));
});

it("maps an outside chip insertion and stales an insertion inside the selected passage", () => {
  const { schema, chip, paragraph } = fixture();
  const doc = paragraph([schema.text("alpha selected omega")]);
  const passage = captureSourceSelection(json(doc), 7, 15).passage;
  for (const [position, outside] of [
    [1, true],
    [10, false],
  ] as const) {
    const edited = new Transform(doc).insert(position, chip());
    const proof = verifySourceEdit(
      json(doc),
      json(edited.doc),
      edited.steps.map((step) => step.toJSON()),
    );
    expect(mapSourcePassage(proof, passage)).toEqual(
      outside
        ? { status: "attached", passage: { ...passage, from: 8, to: 16 } }
        : { status: "stale", reason: "passage-edited" },
    );
  }
});

it("retains an unrelated passage when an outside chip is retargeted", () => {
  const { schema, chip, paragraph } = fixture();
  const doc = paragraph([chip(), schema.text(" selected")]);
  const passage = captureSourceSelection(json(doc), 3, 11).passage;
  const edited = new Transform(doc).setNodeAttribute(1, "target", {
    ...target,
    noteId: "another identity",
  });
  const proof = verifySourceEdit(
    json(doc),
    json(edited.doc),
    edited.steps.map((step) => step.toJSON()),
  );
  expect(mapSourcePassage(proof, passage)).toEqual({
    status: "attached",
    passage,
  });
});
