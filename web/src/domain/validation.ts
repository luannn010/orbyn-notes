import type { Note, NoteDocument, RichNode } from "./contracts";
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
export function safeHref(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^(https?:\/\/|mailto:)/i.test(value) &&
    !/[\u0000-\u0020\u007f]/.test(value)
  );
}
export function validateDocument(value: unknown): NoteDocument {
  let count = 0;
  function node(v: unknown, depth: number): RichNode {
    if (++count > 50000 || depth > 32 || !v || typeof v !== "object")
      throw new Error(
        "invalid_document: The document is too large or malformed.",
      );
    const n = v as RichNode;
    if (
      typeof n.type !== "string" ||
      (depth === 0 ? n.type !== "doc" : !blocks.has(n.type))
    )
      throw new Error("invalid_document: Unsupported document node.");
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
      n.content.forEach((c) => node(c, depth + 1));
    }
    return n;
  }
  node(value, 0);
  if (!Array.isArray((value as NoteDocument).content))
    throw new Error("invalid_document: Missing content.");
  if (JSON.stringify(value).length > 2000000)
    throw new Error("invalid_document: Document exceeds 2 MB.");
  return structuredClone(value as NoteDocument);
}
export function validateInput(input: {
  title: string;
  document: NoteDocument;
  tags: string[];
}): typeof input {
  if (
    typeof input.title !== "string" ||
    input.title.length > 500 ||
    !Array.isArray(input.tags) ||
    input.tags.length > 100 ||
    input.tags.some((t) => typeof t !== "string" || t.length > 100)
  )
    throw new Error("invalid_note: Invalid title or tags.");
  return {
    title: input.title,
    document: validateDocument(input.document),
    tags: [...new Set(input.tags)],
  };
}
export function validateNotes(value: unknown): Note[] {
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
    return { ...v, ...validateInput(v) };
  });
}
