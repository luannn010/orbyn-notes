import type { Note, NoteDocument, RichNode } from "./contracts";
import { validateNoteTarget } from "../links/reference";
export type DocumentPolicy = "plain" | "notes";
export type DocumentInspection = {
  document: NoteDocument;
  nodeVisits: number;
  jsonUnits: number;
};
const blocks = new Set([
  "paragraph",
  "heading",
  "bulletList",
  "orderedList",
  "listItem",
  "taskList",
  "taskItem",
  "blockquote",
  "codeBlock",
  "horizontalRule",
  "hardBreak",
  "text",
]);
function referencePath(
  parent: string,
  child: RichNode,
  index: number,
): boolean {
  if (parent === "paragraph" || parent === "heading")
    return ["text", "hardBreak", "noteLink"].includes(child.type);
  if (parent === "bulletList" || parent === "orderedList")
    return child.type === "listItem";
  if (parent === "taskList") return child.type === "taskItem";
  if (parent === "listItem" || parent === "taskItem")
    return index === 0
      ? child.type === "paragraph"
      : blocks.has(child.type) &&
          !["text", "hardBreak", "listItem", "taskItem"].includes(child.type);
  if (parent === "doc" || parent === "blockquote")
    return (
      blocks.has(child.type) &&
      !["text", "hardBreak", "listItem", "taskItem"].includes(child.type)
    );
  return false;
}
export function safeHref(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^(https?:\/\/|mailto:)/i.test(value) &&
    !/[\u0000-\u0020\u007f]/.test(value)
  );
}
export function inspectNoteDocument(
  value: unknown,
  policy: DocumentPolicy,
): DocumentInspection {
  if (policy !== "plain" && policy !== "notes")
    throw new Error("invalid_document: Unsupported document policy.");
  let count = 0;
  let references = 0;
  function node(
    v: unknown,
    depth: number,
    parent?: string,
    validReferencePath = true,
  ): RichNode {
    if (++count > 50000 || depth > 32 || !v || typeof v !== "object")
      throw new Error(
        "invalid_document: The document is too large or malformed.",
      );
    const n = v as RichNode;
    if (
      typeof n.type !== "string" ||
      (depth === 0
        ? n.type !== "doc"
        : !blocks.has(n.type) && !(policy === "notes" && n.type === "noteLink"))
    )
      throw new Error("invalid_document: Unsupported document node.");
    if (n.type === "noteLink") {
      if (
        !validReferencePath ||
        (parent !== "paragraph" && parent !== "heading")
      )
        throw new Error(
          "invalid_document: A note reference must be inline text content.",
        );
      if (++references > 1000)
        throw new Error("invalid_document: Too many note references.");
      // A reference is an identity atom, never cached visible text, HTML, or
      // another kind of link. PM attribute containers may have a null prototype.
      if (
        Object.keys(n).length !== 2 ||
        !Object.hasOwn(n, "type") ||
        !Object.hasOwn(n, "attrs") ||
        !n.attrs ||
        typeof n.attrs !== "object" ||
        Array.isArray(n.attrs) ||
        Object.keys(n.attrs).length !== 2 ||
        !Object.hasOwn(n.attrs, "version") ||
        !Object.hasOwn(n.attrs, "target") ||
        n.attrs.version !== 1
      )
        throw new Error("invalid_document: Invalid note reference.");
      validateNoteTarget(n.attrs.target);
      return n;
    }
    if (
      n.text !== undefined &&
      (typeof n.text !== "string" || n.text.length > 1000000)
    )
      throw new Error("invalid_document: Invalid text.");
    if (
      n.attrs !== undefined &&
      (!n.attrs || typeof n.attrs !== "object" || Array.isArray(n.attrs))
    )
      throw new Error("invalid_document: Invalid attributes.");
    if (
      n.marks !== undefined &&
      (!Array.isArray(n.marks) ||
        n.marks.some(
          (m) =>
            !["bold", "italic", "strike", "code", "link", "underline"].includes(
              m.type,
            ) ||
            (m.type === "link" && !safeHref(m.attrs?.href)),
        ))
    )
      throw new Error("invalid_document: Unsupported or unsafe formatting.");
    if (n.content !== undefined) {
      if (!Array.isArray(n.content))
        throw new Error("invalid_document: Invalid content.");
      n.content.forEach((c, index) =>
        node(
          c,
          depth + 1,
          n.type,
          validReferencePath && referencePath(n.type, c, index),
        ),
      );
    }
    return n;
  }
  node(value, 0);
  if (!Array.isArray((value as NoteDocument).content))
    throw new Error("invalid_document: Missing content.");
  const jsonUnits = JSON.stringify(value).length;
  if (jsonUnits > 2000000)
    throw new Error("invalid_document: Document exceeds 2 MB.");
  return {
    document: structuredClone(value as NoteDocument),
    nodeVisits: count,
    jsonUnits,
  };
}
/** Generic documents, including Journal and legacy Notes, never admit references. */
export function validateDocument(value: unknown): NoteDocument {
  return inspectNoteDocument(value, "plain").document;
}
export function validateNoteDocument(value: unknown): NoteDocument {
  return inspectNoteDocument(value, "notes").document;
}
type NoteInput = {
  title: string;
  document: NoteDocument;
  tags: string[];
};
function validateInputMetadata(input: NoteInput): void {
  if (
    typeof input.title !== "string" ||
    input.title.length > 500 ||
    !Array.isArray(input.tags) ||
    input.tags.length > 100 ||
    input.tags.some((t) => typeof t !== "string" || t.length > 100)
  )
    throw new Error("invalid_note: Invalid title or tags.");
}
export function validateInput(input: NoteInput): NoteInput {
  return inputForPolicy(input, "plain");
}
export function validateNoteInput(input: NoteInput): NoteInput {
  return inputForPolicy(input, "notes");
}
function inputForPolicy(input: NoteInput, policy: DocumentPolicy): NoteInput {
  validateInputMetadata(input);
  return {
    title: input.title,
    document: inspectNoteDocument(input.document, policy).document,
    tags: [...new Set(input.tags)],
  };
}
export function inspectNotes(
  value: unknown,
  policy: DocumentPolicy = "plain",
): Array<{ note: Note; nodeVisits: number; jsonUnits: number }> {
  if (!Array.isArray(value) || value.length > 10000)
    throw new Error("invalid_library: Invalid library.");
  const ids = new Set<string>();
  return value.map((v: Note) => {
    if (
      !v ||
      typeof v.id !== "string" ||
      ids.has(v.id) ||
      !Number.isSafeInteger(v.revision) ||
      v.revision < 1 ||
      ![v.createdAt, v.updatedAt].every(
        (d) => typeof d === "string" && Number.isFinite(Date.parse(d)),
      ) ||
      (v.trashedAt !== null &&
        (typeof v.trashedAt !== "string" ||
          !Number.isFinite(Date.parse(v.trashedAt))))
    )
      throw new Error("invalid_library: Invalid note metadata.");
    ids.add(v.id);
    validateInputMetadata(v);
    const inspected = inspectNoteDocument(v.document, policy);
    return {
      note: { ...v, document: inspected.document, tags: [...new Set(v.tags)] },
      nodeVisits: inspected.nodeVisits,
      jsonUnits: inspected.jsonUnits,
    };
  });
}
export function validateNotes(
  value: unknown,
  policy: DocumentPolicy = "plain",
): Note[] {
  return inspectNotes(value, policy).map(({ note }) => note);
}
