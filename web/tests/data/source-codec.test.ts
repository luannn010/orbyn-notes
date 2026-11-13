// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  AddMarkStep,
  RemoveMarkStep,
  AddNodeMarkStep,
  RemoveNodeMarkStep,
  AttrStep,
  DocAttrStep,
  ReplaceAroundStep,
  Step,
  StepMap,
  StepResult,
  Transform,
  findWrapping,
} from "@tiptap/pm/transform";
import { Slice, Fragment } from "@tiptap/pm/model";
import { createNoteSchema } from "../../src/editor/schema";
import {
  canonicalSourceDocument,
  captureSourceSelection,
  fingerprintSourceDocument,
  verifySourceEdit,
  mapSourcePassage,
  sourceEditCost,
} from "../../src/study/sourceCodec";
import type { NoteDocument } from "../../src/domain/contracts";
const document = (text = "alpha target omega"): NoteDocument => ({
  type: "doc",
  content: [
    { type: "paragraph", content: text ? [{ type: "text", text }] : [] },
  ],
});
const passage = { from: 7, to: 13, quote: "target" };
const schema = () => createNoteSchema();
describe("writer-verified source passage codec", () => {
  it("uses the actual headless editor schema and stable canonical JSON", () => {
    const first = canonicalSourceDocument(document());
    expect(first).toEqual(
      canonicalSourceDocument(JSON.parse(first.canonicalJSON)),
    );
    expect(schema().nodeFromJSON(first.document).textContent).toBe(
      "alpha target omega",
    );
    expect(() =>
      canonicalSourceDocument({
        type: "doc",
        content: [{ type: "image", attrs: { src: "https://example.test" } }],
      }),
    ).toThrow();
  });
  it("captures exact multiblock context and prevents split-surrogate or atom selections", () => {
    const value: NoteDocument = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "ab" }] },
        { type: "paragraph", content: [{ type: "text", text: "cd" }] },
      ],
    };
    const selected = captureSourceSelection(value, 2, 6);
    expect(selected.passage.quote).toBe("b\nc");
    expect(
      selected.context.text.slice(
        selected.context.selectionFrom,
        selected.context.selectionTo,
      ),
    ).toBe(selected.passage.quote);
    expect(() => captureSourceSelection(document("a📝b"), 2, 3)).toThrow();
    expect(captureSourceSelection(document("a📝b"), 2, 4).passage.quote).toBe(
      "📝",
    );
    expect(() =>
      captureSourceSelection(
        {
          type: "doc",
          content: [
            { type: "paragraph", content: [{ type: "text", text: "ab" }] },
            { type: "horizontalRule" },
            { type: "paragraph", content: [{ type: "text", text: "cd" }] },
          ],
        },
        1,
        8,
      ),
    ).toThrow();
  });
  it("maps surrounding edits and supported marks without searching for duplicate quotes", () => {
    const s = schema(),
      base = s.nodeFromJSON(document());
    const tx = new Transform(base)
      .insert(1, s.text("prefix "))
      .addMark(14, 20, s.marks.bold!.create());
    const proof = verifySourceEdit(
      document(),
      tx.doc.toJSON(),
      tx.steps.map((step) => step.toJSON()),
    );
    expect(mapSourcePassage(proof, passage)).toEqual({
      status: "attached",
      passage: { from: 14, to: 20, quote: "target" },
    });
    expect(() =>
      mapSourcePassage(proof, { ...passage, quote: "invented" }),
    ).toThrow();
  });
  it("stales replacement with identical bytes, insertion inside and delete/cut-paste", () => {
    const s = schema(),
      base = s.nodeFromJSON(document());
    for (const tx of [
      new Transform(base).replaceWith(7, 13, s.text("target")),
      new Transform(base).insert(9, s.text("x")),
      new Transform(base).delete(7, 13).insert(1, s.text("target")),
    ]) {
      expect(
        mapSourcePassage(
          verifySourceEdit(
            document(),
            tx.doc.toJSON(),
            tx.steps.map((step) => step.toJSON()),
          ),
          passage,
        ),
      ).toEqual({ status: "stale", reason: "passage-edited" });
    }
  });
  it("preserves retained-gap structural formatting and rejects mismatched final documents", () => {
    const s = schema(),
      base = s.nodeFromJSON(document()),
      range = base.resolve(0).blockRange(base.resolve(base.content.size))!;
    const tx = new Transform(base).wrap(
      range,
      findWrapping(range, s.nodes.blockquote!)!,
    );
    expect(tx.steps[0]!.toJSON().stepType).toBe("replaceAround");
    expect(
      mapSourcePassage(
        verifySourceEdit(
          document(),
          tx.doc.toJSON(),
          tx.steps.map((step) => step.toJSON()),
        ),
        passage,
      ),
    ).toEqual({
      status: "attached",
      passage: { from: 8, to: 14, quote: "target" },
    });
    expect(() =>
      verifySourceEdit(document(), document("different"), []),
    ).toThrow();
  });
  it("excludes insertions at both selection boundaries", () => {
    const s = schema(),
      base = s.nodeFromJSON(document());
    const tx = new Transform(base)
      .insert(13, s.text(" after"))
      .insert(7, s.text("before "));
    expect(
      mapSourcePassage(
        verifySourceEdit(
          document(),
          tx.doc.toJSON(),
          tx.steps.map((step) => step.toJSON()),
        ),
        passage,
      ),
    ).toEqual({
      status: "attached",
      passage: { from: 14, to: 20, quote: "target" },
    });
  });
  it("snapshots its fingerprint before asynchronous hashing", async () => {
    const value = document();
    const pending = fingerprintSourceDocument(value);
    value.content[0]!.content![0]!.text = "later mutation";
    const result = await pending;
    expect(result.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(result.document).toEqual(document());
    expect(result.canonicalJSON).not.toContain("later mutation");
    expect(result.digest).toBe(
      (await fingerprintSourceDocument(document())).digest,
    );
  });
  it("rejects unknown steps even when their map is empty and cannot forge verified handles", () => {
    class UnknownStep extends Step {
      apply(doc: ReturnType<ReturnType<typeof schema>["nodeFromJSON"]>) {
        return StepResult.ok(doc);
      }
      getMap() {
        return StepMap.empty;
      }
      invert() {
        return this;
      }
      map() {
        return this;
      }
      toJSON() {
        return { stepType: "source-codec-test-unknown" };
      }
      static fromJSON() {
        return new UnknownStep();
      }
    }
    Step.jsonID("source-codec-test-unknown", UnknownStep);
    expect(() =>
      verifySourceEdit(document(), document(), [new UnknownStep().toJSON()]),
    ).toThrow();
    expect(() =>
      mapSourcePassage({} as ReturnType<typeof verifySourceEdit>, passage),
    ).toThrow();
  });
  it("bounds step payload and refuses an unsupported attribute instead of dropping it", () => {
    expect(() =>
      verifySourceEdit(
        document(),
        document(),
        Array.from({ length: 1001 }, () => ({ stepType: "addMark" })),
      ),
    ).toThrow();
    expect(() =>
      canonicalSourceDocument({
        type: "doc",
        content: [
          {
            type: "paragraph",
            attrs: { unknown: "do not drop" },
            content: [{ type: "text", text: "x" }],
          },
        ],
      }),
    ).toThrow();
  });
  it("replays the actual first insertion from a stored empty document without inventing a base paragraph", () => {
    const empty: NoteDocument = { type: "doc", content: [] },
      s = schema();
    const tx = new Transform(s.nodeFromJSON(empty)).insert(
      0,
      s.nodes.paragraph!.create(null, s.text("target")),
    );
    expect(canonicalSourceDocument(empty).document).toEqual(empty);
    expect(() =>
      verifySourceEdit(
        empty,
        tx.doc.toJSON(),
        tx.steps.map((step) => step.toJSON()),
      ),
    ).not.toThrow();
  });
  it("round-trips the installed restricted markSet, rejects unknown or nested children", () => {
    const s = schema(),
      add = new AddMarkStep(7, 13, s.marks.bold!.create()).toJSON(),
      remove = new RemoveMarkStep(7, 13, s.marks.bold!.create()).toJSON();
    const batch = { stepType: "markSet", steps: [add, remove] };
    expect(
      Step.fromJSON(s, batch).apply(s.nodeFromJSON(document())).doc!.toJSON(),
    ).toEqual(document());
    expect(
      mapSourcePassage(
        verifySourceEdit(document(), document(), [batch]),
        passage,
      ),
    ).toEqual({ status: "attached", passage });
    expect(() =>
      verifySourceEdit(document(), document(), [
        { stepType: "markSet", steps: [batch] },
      ]),
    ).toThrow();
    expect(() =>
      verifySourceEdit(document(), document(), [
        {
          stepType: "markSet",
          steps: [{ stepType: "attr", pos: 0, attr: "unknown", value: 1 }],
        },
      ]),
    ).toThrow();
  });
  it("supports admitted node marks and attributes but rejects unsupported doc attributes", () => {
    const s = schema(),
      value: NoteDocument = {
        type: "doc",
        content: [
          {
            type: "heading",
            attrs: { level: 2 },
            content: [{ type: "text", text: "alpha target omega" }],
          },
        ],
      };
    const tx = new Transform(s.nodeFromJSON(value)).step(
      new AttrStep(0, "level", 3),
    );
    expect(
      mapSourcePassage(
        verifySourceEdit(
          value,
          tx.doc.toJSON(),
          tx.steps.map((step) => step.toJSON()),
        ),
        passage,
      ),
    ).toEqual({ status: "attached", passage });
    expect(() =>
      verifySourceEdit(value, value, [
        new DocAttrStep("unknown", true).toJSON(),
      ]),
    ).toThrow();
    const withBreak: NoteDocument = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "a" },
            { type: "hardBreak" },
            { type: "text", text: "b" },
          ],
        },
      ],
    };
    const marked = new Transform(s.nodeFromJSON(withBreak))
      .step(new AddNodeMarkStep(2, s.marks.bold!.create()))
      .step(new RemoveNodeMarkStep(2, s.marks.bold!.create()));
    expect(
      mapSourcePassage(
        verifySourceEdit(
          withBreak,
          marked.doc.toJSON(),
          marked.steps.map((step) => step.toJSON()),
        ),
        { from: 1, to: 4, quote: "a\nb" },
      ),
    ).toEqual({
      status: "attached",
      passage: { from: 1, to: 4, quote: "a\nb" },
    });
  });
  it("stales the removed side of a valid replaceAround while preserving its exact retained gap", () => {
    const s = schema(),
      base = s.nodeFromJSON(document()),
      replacement = new Slice(
        Fragment.from(s.nodes.paragraph!.create(null, s.text("replacement "))),
        0,
        0,
      );
    const tx = new Transform(base).step(
      new ReplaceAroundStep(0, base.content.size, 7, 13, replacement, 13),
    );
    const proof = verifySourceEdit(
      document(),
      tx.doc.toJSON(),
      tx.steps.map((step) => step.toJSON()),
    );
    expect(mapSourcePassage(proof, passage)).toEqual({
      status: "attached",
      passage: { from: 13, to: 19, quote: "target" },
    });
    expect(mapSourcePassage(proof, { from: 1, to: 6, quote: "alpha" })).toEqual(
      { status: "stale", reason: "passage-edited" },
    );
  });
  it("preserves literal replacement characters in text but rejects malformed or ignored proof fields", () => {
    expect(
      captureSourceSelection(document("a\ufffcb"), 1, 4).passage.quote,
    ).toBe("a\ufffcb");
    expect(() =>
      verifySourceEdit(document(), document(), [
        {
          stepType: "addMark",
          from: 0,
          to: 0,
          mark: { type: "link", attrs: { href: "javascript:bad" } },
        },
      ]),
    ).toThrow();
    expect(() =>
      verifySourceEdit(document(), document(), [
        { stepType: "attr", pos: 0, attr: "level" },
      ]),
    ).toThrow();
    expect(() =>
      verifySourceEdit(document(), document(), [
        {
          stepType: "replace",
          from: 1,
          to: 1,
          slice: {
            content: [{ type: "text", text: "", attrs: { unknown: true } }],
          },
        },
      ]),
    ).toThrow();
    expect(() =>
      mapSourcePassage(
        verifySourceEdit(document(), document(), []),
        null as unknown as typeof passage,
      ),
    ).toThrow(/could not be verified/);
  });
  it("charges zero-step validation and serialized attributes in batch mapping metrics", () => {
    const value: NoteDocument = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "x",
              marks: [
                {
                  type: "link",
                  attrs: { href: `https://example.test/${"a".repeat(20000)}` },
                },
              ],
            },
          ],
        },
      ],
    };
    const edit = verifySourceEdit(value, value, []),
      cost = sourceEditCost(edit);
    expect(cost.stepCount).toBe(0);
    expect(cost.maxDocumentUnits).toBeGreaterThan(20000);
    expect(cost.replayUnits).toBeGreaterThan(40000);
    expect(() =>
      sourceEditCost({} as ReturnType<typeof verifySourceEdit>),
    ).toThrow();
    expect(sourceEditCost(edit)).toEqual(cost);
    expect(Object.isFrozen(cost)).toBe(true);
  });
});
