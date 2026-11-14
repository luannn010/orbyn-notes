import type { NoteDocument, RichNode } from "../domain/contracts";
import { inspectNoteDocument } from "../domain/validation";
import { NoteLinkError, type NoteLinksRow, type NoteTarget } from "./contracts";
import { validateNoteTarget } from "./reference";

export const NOTE_LINK_LIMITS = Object.freeze({
  references: 1000,
  totalReferences: 100000,
  rows: 10000,
  documentBytes: 8 * 1024 * 1024,
  documentNodes: 50000,
  workBytes: 64 * 1024 * 1024,
  workNodes: 250000,
  yieldNodes: 2048,
  searchUnits: 5000000,
});
export type LinkWork = { utf8Units: number; nodeVisits: number };
export const targetKey = (target: NoteTarget): string =>
  JSON.stringify([target.accountId, target.libraryEpoch, target.noteId]);
export function charge(work: LinkWork, units: number, nodes: number): void {
  if (
    work.utf8Units + units > NOTE_LINK_LIMITS.workBytes ||
    work.nodeVisits + nodes > NOTE_LINK_LIMITS.workNodes
  )
    throw new NoteLinkError("note_link_verification_limit");
  work.utf8Units += units;
  work.nodeVisits += nodes;
}
export function inspectLinkDocument(
  document: unknown,
  policy: "plain" | "notes",
  work: LinkWork,
): NoteDocument {
  const inspected = inspectNoteDocument(document, policy);
  if (
    inspected.jsonUnits * 3 > NOTE_LINK_LIMITS.documentBytes ||
    inspected.nodeVisits > NOTE_LINK_LIMITS.documentNodes
  )
    throw new NoteLinkError("note_link_limit");
  charge(work, inspected.jsonUnits * 3, inspected.nodeVisits);
  return inspected.document;
}
export function scanLinkDocument(
  document: NoteDocument,
  work: LinkWork,
): NoteLinksRow["targets"] {
  const found = new Map<string, { target: NoteTarget; occurrences: number }>();
  const queue: RichNode[] = [document];
  let count = 0;
  while (queue.length) {
    const node = queue.pop()!;
    charge(work, 0, 1);
    if (node.type === "noteLink") {
      const target = validateNoteTarget(node.attrs?.target);
      if (++count > NOTE_LINK_LIMITS.references)
        throw new NoteLinkError("note_link_limit");
      const key = targetKey(target),
        prior = found.get(key);
      if (prior) prior.occurrences++;
      else found.set(key, { target, occurrences: 1 });
    }
    if (node.content)
      for (let i = node.content.length - 1; i >= 0; i--)
        queue.push(node.content[i]!);
  }
  return [...found.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([, row]) => row);
}
export function validateLinkRows(
  input: unknown,
  notes: readonly { id: string; revision: number }[],
): NoteLinksRow[] {
  if (!Array.isArray(input) || input.length > NOTE_LINK_LIMITS.rows)
    throw new NoteLinkError("note_link_index_invalid");
  const current = new Map(notes.map((note) => [note.id, note.revision])),
    seen = new Set<string>();
  let total = 0;
  const rows: NoteLinksRow[] = [];
  for (const value of input) {
    if (
      !value ||
      typeof value !== "object" ||
      Object.keys(value).sort().join() !== "noteId,noteRevision,targets" ||
      typeof value.noteId !== "string" ||
      current.get(value.noteId) !== value.noteRevision ||
      seen.has(value.noteId) ||
      !Array.isArray(value.targets) ||
      value.targets.length > NOTE_LINK_LIMITS.references
    )
      throw new NoteLinkError("note_link_index_invalid");
    seen.add(value.noteId);
    const targets: NoteLinksRow["targets"] = [],
      keys = new Set<string>();
    let perNote = 0;
    for (const entry of value.targets) {
      if (
        !entry ||
        typeof entry !== "object" ||
        Object.keys(entry).sort().join() !== "occurrences,target" ||
        !Number.isSafeInteger(entry.occurrences) ||
        entry.occurrences < 1
      )
        throw new NoteLinkError("note_link_index_invalid");
      const target = validateNoteTarget(entry.target),
        key = targetKey(target);
      if (keys.has(key)) throw new NoteLinkError("note_link_index_invalid");
      keys.add(key);
      perNote += entry.occurrences;
      total += entry.occurrences;
      if (
        perNote > NOTE_LINK_LIMITS.references ||
        total > NOTE_LINK_LIMITS.totalReferences
      )
        throw new NoteLinkError("note_link_limit");
      targets.push({ target, occurrences: entry.occurrences });
    }
    rows.push({
      noteId: value.noteId,
      noteRevision: value.noteRevision,
      targets,
    });
  }
  // Rows with no references are omitted. Completeness is a document-proof
  // property and deliberately not inferred by this structural validator.
  if (rows.some((row) => row.targets.length === 0))
    throw new NoteLinkError("note_link_index_invalid");
  return rows;
}
export function sameTargets(
  a: NoteLinksRow["targets"],
  b: NoteLinksRow["targets"],
): boolean {
  if (a.length !== b.length) return false;
  const map = new Map(a.map((row) => [targetKey(row.target), row.occurrences]));
  return b.every((row) => map.get(targetKey(row.target)) === row.occurrences);
}

export async function scanLinkDocumentAsync(
  document: NoteDocument,
  work: LinkWork,
  fresh: () => void,
  snippet?: { text: string },
): Promise<NoteLinksRow["targets"]> {
  const found = new Map<string, { target: NoteTarget; occurrences: number }>(),
    queue: RichNode[] = [document];
  let count = 0,
    sinceYield = 0,
    started = performance.now();
  while (queue.length) {
    fresh();
    const node = queue.pop()!;
    charge(work, 0, 1);
    if (snippet && snippet.text.length < 160)
      snippet.text += (
        node.type === "noteLink"
          ? "Note reference"
          : node.type === "hardBreak"
            ? "\n"
            : (node.text ?? "")
      ).slice(0, 160 - snippet.text.length);
    if (node.type === "noteLink") {
      const target = validateNoteTarget(node.attrs?.target),
        key = targetKey(target),
        prior = found.get(key);
      if (++count > NOTE_LINK_LIMITS.references)
        throw new NoteLinkError("note_link_limit");
      if (prior) prior.occurrences++;
      else found.set(key, { target, occurrences: 1 });
    }
    if (node.content)
      for (let i = node.content.length - 1; i >= 0; i--)
        queue.push(node.content[i]!);
    if (
      ++sinceYield >= NOTE_LINK_LIMITS.yieldNodes ||
      performance.now() - started >= 8
    ) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      fresh();
      sinceYield = 0;
      started = performance.now();
    }
  }
  return [...found.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([, row]) => row);
}
