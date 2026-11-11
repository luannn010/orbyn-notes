import { Node as PMNode, type Schema } from "@tiptap/pm/model";
import {
  Step,
  AddMarkStep,
  RemoveMarkStep,
  AddNodeMarkStep,
  RemoveNodeMarkStep,
  AttrStep,
  DocAttrStep,
  ReplaceStep,
  ReplaceAroundStep,
} from "@tiptap/pm/transform";
import type { NoteDocument } from "../domain/contracts";
import { validateNoteDocument, safeHref } from "../domain/validation";
import { createNoteSchema } from "../editor/schema";

export type SourcePassage = Readonly<{
  from: number;
  to: number;
  quote: string;
}>;
export type SourceSelection = Readonly<{
  passage: SourcePassage;
  context: Readonly<{
    text: string;
    selectionFrom: number;
    selectionTo: number;
  }>;
}>;
export type SourceFingerprint = Readonly<{
  document: NoteDocument;
  canonicalJSON: string;
  digest: string;
}>;
export type SourceEditProof = Readonly<{
  baseDigest: string;
  finalDigest: string;
  steps: readonly unknown[];
}>;
declare const verifiedBrand: unique symbol;
export type VerifiedSourceEdit = Readonly<{ [verifiedBrand]: true }>;
export type SourceMapping =
  | { status: "attached"; passage: SourcePassage }
  | { status: "stale"; reason: "passage-edited" };
export class SourceCodecError extends Error {
  constructor(
    public readonly code: "source_codec_invalid" | "source_codec_limit",
  ) {
    super(
      code === "source_codec_limit"
        ? "This source selection or edit exceeds the supported verification limits."
        : "This source passage or edit could not be verified.",
    );
    this.name = "SourceCodecError";
  }
}
export const SOURCE_CODEC_LIMITS = Object.freeze({
  steps: 1000,
  proofBytes: 2 * 1024 * 1024,
  text: 100000,
  replayUnits: 64 * 1024 * 1024,
});
type Transition = { before: PMNode; after: PMNode; step: Step };
type Verified = {
  base: PMNode;
  final: PMNode;
  transitions: Transition[];
  cost: { replayUnits: number; stepCount: number; maxDocumentUnits: number };
};
const verified = new WeakMap<VerifiedSourceEdit, Verified>();
function invalid(): never {
  throw new SourceCodecError("source_codec_invalid");
}
function limit(): never {
  throw new SourceCodecError("source_codec_limit");
}
function record(value: unknown): Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    invalid();
  return value as Record<string, unknown>;
}
function stable(value: unknown, depth = 0): unknown {
  if (depth > 64) invalid();
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) invalid();
    return value;
  }
  if (Array.isArray(value)) return value.map((item) => stable(item, depth + 1));
  const row = record(value),
    output: Record<string, unknown> = Object.create(null);
  for (const key of Object.keys(row).sort())
    output[key] = stable(row[key], depth + 1);
  return output;
}
function rawMark(value: unknown, schema: Schema): void {
  const mark = record(value);
  if (
    typeof mark.type !== "string" ||
    !Object.hasOwn(schema.marks, mark.type) ||
    Object.keys(mark).some((key) => !["type", "attrs"].includes(key))
  )
    invalid();
  const definition = schema.marks[mark.type]!;
  if (mark.attrs !== undefined) {
    const attrs = record(mark.attrs);
    if (
      Object.keys(attrs).some(
        (key) => !Object.hasOwn(definition.spec.attrs ?? {}, key),
      )
    )
      invalid();
    stable(attrs);
  }
  if (mark.type === "link") {
    const href = (mark.attrs as Record<string, unknown> | undefined)?.href;
    if (!safeHref(href)) invalid();
    try {
      if (!["http:", "https:", "mailto:"].includes(new URL(href).protocol))
        invalid();
    } catch {
      invalid();
    }
  }
}
function rawNode(value: unknown, schema: Schema): void {
  const row = record(value);
  if (
    Object.keys(row).some(
      (key) => !["type", "attrs", "text", "marks", "content"].includes(key),
    )
  )
    invalid();
  if (typeof row.type !== "string" || !Object.hasOwn(schema.nodes, row.type))
    invalid();
  if (row.text !== undefined && row.type !== "text") invalid();
  const type = schema.nodes[row.type]!;
  if (row.attrs !== undefined) {
    const attrs = record(row.attrs);
    if (
      Object.keys(attrs).some(
        (key) => !Object.hasOwn(type.spec.attrs ?? {}, key),
      )
    )
      invalid();
    stable(attrs);
  }
  if (row.marks !== undefined) {
    if (!Array.isArray(row.marks)) invalid();
    for (const value of row.marks) rawMark(value, schema);
  }
  if (row.type === "text" && row.content !== undefined) invalid();
  if (row.content !== undefined) {
    if (!Array.isArray(row.content)) invalid();
    for (const child of row.content) rawNode(child, schema);
  }
}
function canonical(
  input: unknown,
  schema: Schema,
): { document: NoteDocument; canonicalJSON: string; node: PMNode } {
  try {
    const row = record(input);
    const emptyEditorJSON = row.type === "doc" && Object.keys(row).length === 1;
    const checked = validateNoteDocument(
      emptyEditorJSON ? { type: "doc", content: [] } : input,
    );
    rawNode(checked, schema);
    // The existing editor admits a stored legacy empty doc until its first insertion.
    // Keep that exact base for transaction replay; never invent an unrecorded paragraph.
    const node = schema.nodeFromJSON(checked);
    if (checked.content.length) node.check();
    const serialized = node.toJSON();
    const document = validateNoteDocument(
      node.childCount ? serialized : { ...serialized, content: [] },
    );
    rawNode(document, schema);
    return { document, canonicalJSON: JSON.stringify(stable(document)), node };
  } catch (error) {
    if (error instanceof SourceCodecError) throw error;
    invalid();
  }
}
export function canonicalSourceDocument(input: unknown): {
  document: NoteDocument;
  canonicalJSON: string;
} {
  const result = canonical(input, createNoteSchema());
  return { document: result.document, canonicalJSON: result.canonicalJSON };
}
function integer(value: unknown, max: number): asserts value is number {
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < 0 ||
    (value as number) > max
  )
    invalid();
}
function scalarBoundary(doc: PMNode, position: number): void {
  const resolved = doc.resolve(position),
    before = resolved.nodeBefore,
    after = resolved.nodeAfter;
  const left = before?.isText
    ? before.text?.charCodeAt(before.text.length - 1)
    : undefined;
  const right = after?.isText ? after.text?.charCodeAt(0) : undefined;
  if (
    left !== undefined &&
    right !== undefined &&
    left >= 0xd800 &&
    left <= 0xdbff &&
    right >= 0xdc00 &&
    right <= 0xdfff
  )
    invalid();
}
const leafText = (node: PMNode) =>
  node.type.name === "hardBreak" ? "\n" : "\ufffc";
function projection(doc: PMNode, from: number, to: number): string {
  return doc.textBetween(from, to, "\n", leafText);
}
function checkedPassage(
  doc: PMNode,
  from: number,
  to: number,
  expected?: string,
): SourcePassage {
  integer(from, doc.content.size);
  integer(to, doc.content.size);
  if (
    from >= to ||
    !doc.resolve(from).parent.isTextblock ||
    !doc.resolve(to).parent.isTextblock
  )
    invalid();
  scalarBoundary(doc, from);
  scalarBoundary(doc, to);
  doc.nodesBetween(from, to, (node) => {
    if (node.isLeaf && !node.isText && node.type.name !== "hardBreak")
      invalid();
  });
  const quote = projection(doc, from, to);
  if (!quote.trim()) invalid();
  if (quote.length > SOURCE_CODEC_LIMITS.text) limit();
  if (expected !== undefined && quote !== expected) invalid();
  return Object.freeze({ from, to, quote });
}
export function captureSourceSelection(
  document: NoteDocument,
  from: number,
  to: number,
): SourceSelection {
  const { node } = canonical(document, createNoteSchema()),
    passage = checkedPassage(node, from, to);
  let contextFrom = node.resolve(from).start(),
    contextTo = node.resolve(to).end();
  // A reference's authorized display title is not persisted prose. Bound the
  // real text context at adjacent chips, never insert an object marker/title
  // into a Cloze answer or search for an equal quote somewhere else.
  node.nodesBetween(contextFrom, contextTo, (child, position) => {
    if (child.type.name !== "noteLink") return;
    if (position + child.nodeSize <= from)
      contextFrom = Math.max(contextFrom, position + child.nodeSize);
    else if (position >= to) contextTo = Math.min(contextTo, position);
  });
  const text = projection(node, contextFrom, contextTo),
    selectionFrom = projection(node, contextFrom, from).length;
  if (text.length > SOURCE_CODEC_LIMITS.text) limit();
  const selectionTo = selectionFrom + passage.quote.length;
  if (text.slice(selectionFrom, selectionTo) !== passage.quote) invalid();
  return Object.freeze({
    passage,
    context: Object.freeze({ text, selectionFrom, selectionTo }),
  });
}
export async function fingerprintSourceDocument(
  document: NoteDocument,
): Promise<SourceFingerprint> {
  const result = canonicalSourceDocument(document),
    bytes = new TextEncoder().encode(result.canonicalJSON);
  try {
    const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
    try {
      return Object.freeze({
        ...result,
        digest: Array.from(hash, (byte) =>
          byte.toString(16).padStart(2, "0"),
        ).join(""),
      });
    } finally {
      hash.fill(0);
    }
  } finally {
    bytes.fill(0);
  }
}
function stepRows(input: readonly unknown[]): Record<string, unknown>[] {
  if (!Array.isArray(input)) invalid();
  if (input.length > SOURCE_CODEC_LIMITS.steps) limit();
  let copy: unknown;
  try {
    copy = structuredClone(input);
  } catch {
    invalid();
  }
  const rows = copy as unknown[],
    bytes = new TextEncoder().encode(JSON.stringify(stable(rows)));
  if (bytes.byteLength > SOURCE_CODEC_LIMITS.proofBytes) limit();
  const result: Record<string, unknown>[] = [];
  let count = 0;
  for (const value of rows) {
    const row = record(value);
    if (++count > SOURCE_CODEC_LIMITS.steps) limit();
    if (row.stepType === "markSet") {
      if (
        Object.keys(row).some((key) => !["stepType", "steps"].includes(key)) ||
        !Array.isArray(row.steps)
      )
        invalid();
      for (const child of row.steps) {
        const next = record(child);
        if (++count > SOURCE_CODEC_LIMITS.steps) limit();
        if (next.stepType !== "addMark" && next.stepType !== "removeMark")
          invalid();
        result.push(next);
      }
    } else result.push(row);
  }
  return result;
}
function checkedStep(
  row: Record<string, unknown>,
  doc: PMNode,
  schema: Schema,
): Step {
  const keys: Record<string, string[]> = {
    addMark: ["stepType", "from", "to", "mark"],
    removeMark: ["stepType", "from", "to", "mark"],
    addNodeMark: ["stepType", "pos", "mark"],
    removeNodeMark: ["stepType", "pos", "mark"],
    attr: ["stepType", "pos", "attr", "value"],
    docAttr: ["stepType", "attr", "value"],
    replace: ["stepType", "from", "to", "slice", "structure"],
    replaceAround: [
      "stepType",
      "from",
      "to",
      "gapFrom",
      "gapTo",
      "insert",
      "slice",
      "structure",
    ],
  };
  if (
    typeof row.stepType !== "string" ||
    !Object.hasOwn(keys, row.stepType) ||
    Object.keys(row).some((key) => !keys[row.stepType as string]!.includes(key))
  )
    invalid();
  const required = keys[row.stepType]!.filter(
    (key) => !["slice", "structure"].includes(key),
  );
  if (required.some((key) => !Object.hasOwn(row, key))) invalid();
  if (Object.hasOwn(row, "mark")) rawMark(row.mark, schema);
  if (Object.hasOwn(row, "slice") && row.slice !== null) {
    const slice = record(row.slice);
    if (
      Object.keys(slice).some(
        (key) => !["content", "openStart", "openEnd"].includes(key),
      )
    )
      invalid();
    for (const key of ["openStart", "openEnd"])
      if (Object.hasOwn(slice, key)) integer(slice[key], 32);
    if (slice.content !== undefined) {
      if (!Array.isArray(slice.content)) invalid();
      for (const node of slice.content) rawNode(node, schema);
    }
  }
  for (const key of ["from", "to", "pos", "gapFrom", "gapTo"])
    if (Object.hasOwn(row, key)) integer(row[key], doc.content.size);
  if (Object.hasOwn(row, "insert")) integer(row.insert, 2000000);
  if (Object.hasOwn(row, "structure") && typeof row.structure !== "boolean")
    invalid();
  if (row.stepType === "attr" || row.stepType === "docAttr") {
    const target =
      row.stepType === "docAttr" ? doc : doc.nodeAt(row.pos as number);
    if (
      !target ||
      typeof row.attr !== "string" ||
      !Object.hasOwn(target.type.spec.attrs ?? {}, row.attr)
    )
      invalid();
  }
  try {
    const step = Step.fromJSON(schema, row);
    if (!(
      step instanceof AddMarkStep ||
      step instanceof RemoveMarkStep ||
      step instanceof AddNodeMarkStep ||
      step instanceof RemoveNodeMarkStep ||
      step instanceof AttrStep ||
      step instanceof DocAttrStep ||
      step instanceof ReplaceStep ||
      step instanceof ReplaceAroundStep
    ))
      invalid();
    if (step instanceof ReplaceStep && step.from > step.to) invalid();
    if (
      step instanceof ReplaceAroundStep &&
      !(
        step.from <= step.gapFrom &&
        step.gapFrom <= step.gapTo &&
        step.gapTo <= step.to &&
        step.insert <= step.slice.size
      )
    )
      invalid();
    return step;
  } catch (error) {
    if (error instanceof SourceCodecError) throw error;
    invalid();
  }
}
export function verifySourceEdit(
  base: NoteDocument,
  final: NoteDocument,
  steps: readonly unknown[],
): VerifiedSourceEdit {
  const schema = createNoteSchema(),
    start = canonical(base, schema),
    end = canonical(final, schema),
    rows = stepRows(steps);
  let node = start.node;
  let beforeUnits = Math.max(start.canonicalJSON.length, node.content.size + 1);
  let maxDocumentUnits = Math.max(
    beforeUnits,
    end.canonicalJSON.length,
    end.node.content.size + 1,
  );
  let work =
    beforeUnits + Math.max(end.canonicalJSON.length, end.node.content.size + 1);
  const transitions: Transition[] = [];
  for (const row of rows) {
    work += beforeUnits;
    if (work > SOURCE_CODEC_LIMITS.replayUnits) limit();
    const step = checkedStep(row, node, schema);
    let after: PMNode;
    try {
      const result = step.apply(node);
      if (result.failed || !result.doc) invalid();
      after = result.doc;
      after.check();
      const json = validateNoteDocument(after.toJSON());
      rawNode(json, schema);
      const afterUnits = Math.max(
        JSON.stringify(json).length,
        after.content.size + 1,
      );
      work += afterUnits;
      if (work > SOURCE_CODEC_LIMITS.replayUnits) limit();
      maxDocumentUnits = Math.max(maxDocumentUnits, afterUnits);
      beforeUnits = afterUnits;
    } catch (error) {
      if (error instanceof SourceCodecError) throw error;
      invalid();
    }
    if (
      !(step instanceof ReplaceStep || step instanceof ReplaceAroundStep) &&
      (node.content.size !== after.content.size ||
        projection(node, 0, node.content.size) !==
          projection(after, 0, after.content.size))
    )
      invalid();
    if (step instanceof ReplaceAroundStep) {
      const original = node.slice(step.gapFrom, step.gapTo),
        moved = after.slice(
          step.from + step.insert,
          step.from + step.insert + (step.gapTo - step.gapFrom),
        );
      if (!original.eq(moved)) invalid();
    }
    transitions.push({ before: node, after, step });
    node = after;
  }
  if (!node.eq(end.node)) invalid();
  const handle = Object.freeze({}) as VerifiedSourceEdit;
  verified.set(handle, {
    base: start.node,
    final: end.node,
    transitions,
    cost: {
      replayUnits: work,
      stepCount: transitions.length,
      maxDocumentUnits,
    },
  });
  return handle;
}
/** Conservative serialized/position traversal cost; includes zero-step base/final validation. */
export function sourceEditCost(edit: VerifiedSourceEdit): Readonly<{
  replayUnits: number;
  stepCount: number;
  maxDocumentUnits: number;
}> {
  const data = edit && verified.get(edit);
  if (!data) invalid();
  return Object.freeze({ ...data.cost });
}
export function mapSourcePassage(
  edit: VerifiedSourceEdit,
  passage: SourcePassage,
): SourceMapping {
  const data = edit && verified.get(edit);
  if (!data) invalid();
  if (typeof record(passage).quote !== "string") invalid();
  let current = checkedPassage(
    data.base,
    passage.from,
    passage.to,
    passage.quote,
  );
  if (
    data.transitions.length * current.quote.length >
    SOURCE_CODEC_LIMITS.replayUnits
  )
    limit();
  for (const { step, after } of data.transitions) {
    let stale = false;
    if (step instanceof ReplaceStep) {
      stale =
        step.from === step.to
          ? current.from < step.from && step.from < current.to
          : step.from < current.to && step.to > current.from;
    } else if (step instanceof ReplaceAroundStep) {
      const intersects = step.from < current.to && step.to > current.from;
      stale =
        intersects &&
        !(current.from >= step.gapFrom && current.to <= step.gapTo);
    }
    if (stale) return { status: "stale", reason: "passage-edited" };
    const map = step.getMap(),
      from = map.map(current.from, 1),
      to = map.map(current.to, -1);
    try {
      current = checkedPassage(after, from, to, current.quote);
    } catch (error) {
      if (
        error instanceof SourceCodecError &&
        error.code === "source_codec_invalid"
      )
        return { status: "stale", reason: "passage-edited" };
      throw error;
    }
  }
  return { status: "attached", passage: current };
}
