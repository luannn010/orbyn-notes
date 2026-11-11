import type { Note } from "../domain/contracts";
import { inspectNotes } from "../domain/validation";
import type {
  LinkToken,
  NoteExportFile,
  NoteLinkResolution,
  NoteTarget,
} from "../links/contracts";
import { NoteLinkError } from "../links/contracts";
import { encodeNoteReference, validateNoteTarget } from "../links/reference";
import {
  escapeMarkdownText,
  markdownCodeSpan,
  renderMarkdownSnapshot,
} from "./index";

export type AuthorizedNoteExportProjection = Readonly<{
  accountId: string;
  token: LinkToken;
  references: readonly Readonly<{
    target: NoteTarget;
    resolution: NoteLinkResolution;
  }>[];
  consumedWork?: Readonly<{ utf8Units: number; nodeVisits: number }>;
}>;
export const NOTE_EXPORT_LIMITS = Object.freeze({
  utf8Units: 64 * 1024 * 1024,
  nodeVisits: 250000,
  references: 100000,
});
const key = (target: NoteTarget) =>
  JSON.stringify([
    target.kind,
    target.accountId,
    target.libraryEpoch,
    target.noteId,
  ]);
const invalid = (): never => {
  throw new NoteLinkError("note_link_invalid");
};
const limit = (): never => {
  throw new NoteLinkError("note_link_limit");
};

/** Formatting is not authorization. The real service captures this projection
 * and checks its generation/token again before publishing or downloading files. */
export function renderNoteExport(
  notes: readonly Note[],
  projection: AuthorizedNoteExportProjection,
): { files: NoteExportFile[]; warnings: string[] } {
  validateNoteTarget({
    kind: "note",
    accountId: projection.accountId,
    libraryEpoch: projection.token.epoch,
    noteId: "",
  });
  if (
    !Number.isSafeInteger(projection.token.revision) ||
    projection.token.revision < 0
  )
    invalid();
  if (
    !Array.isArray(notes) ||
    notes.length > 10000 ||
    !Array.isArray(projection.references) ||
    projection.references.length > NOTE_EXPORT_LIMITS.references
  )
    limit();
  const labels = new Map<string, string>();
  let units = projection.consumedWork?.utf8Units ?? 0,
    visits = projection.consumedWork?.nodeVisits ?? 0;
  if (
    !Number.isSafeInteger(units) ||
    units < 0 ||
    !Number.isSafeInteger(visits) ||
    visits < 0
  )
    invalid();
  if (
    units > NOTE_EXPORT_LIMITS.utf8Units ||
    visits > NOTE_EXPORT_LIMITS.nodeVisits
  )
    limit();
  const charge = (text: string) => {
    const before = units;
    // Exact UTF8 length, including replacement bytes for unpaired UTF16, without
    // allocating an oversized encoded buffer merely to discover the limit.
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      let size = c < 0x80 ? 1 : c < 0x800 ? 2 : 3;
      if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length) {
        const next = text.charCodeAt(i + 1);
        if (next >= 0xdc00 && next <= 0xdfff) {
          size = 4;
          i++;
        }
      }
      if (units + size > NOTE_EXPORT_LIMITS.utf8Units) limit();
      units += size;
    }
    return units - before;
  };
  const reserve = (upperBytes: number) => {
    if (
      !Number.isSafeInteger(upperBytes) ||
      upperBytes < 0 ||
      units + upperBytes > NOTE_EXPORT_LIMITS.utf8Units
    )
      limit();
    units += upperBytes;
  };
  for (const item of projection.references) {
    const target = validateNoteTarget(item.target);
    charge(key(target));
    let label = "Note reference";
    const resolution = item.resolution;
    if (resolution.status === "available") {
      if (
        key(validateNoteTarget(resolution.target)) !== key(target) ||
        target.accountId !== projection.accountId ||
        target.libraryEpoch !== projection.token.epoch ||
        resolution.token.epoch !== projection.token.epoch ||
        resolution.token.revision !== projection.token.revision ||
        typeof resolution.title !== "string" ||
        resolution.title.length > 500 ||
        !Number.isSafeInteger(resolution.noteRevision) ||
        resolution.noteRevision < 1
      )
        invalid();
      label = resolution.title || "Untitled";
    } else if (resolution.status !== "unavailable") invalid();
    const identity = key(target);
    if (labels.has(identity) && labels.get(identity) !== label) invalid();
    labels.set(identity, label);
  }
  const serialized: string[] = [],
    markdown: NoteExportFile[] = [],
    ids = new Set<string>();
  let serializedBytes = 0;
  const warnings = new Set<string>([
    "Markdown import does not restore note-link relationships or map original note IDs to imported notes.",
    "These files are plaintext and are not a complete workspace backup. They contain Notes only; Journal, Study, Clips, source anchors and version history are not included.",
  ]);
  for (const candidate of notes) {
    const inspected = inspectNotes([candidate], "notes")[0]!;
    visits += inspected.nodeVisits;
    units += inspected.jsonUnits * 3;
    if (
      visits > NOTE_EXPORT_LIMITS.nodeVisits ||
      units > NOTE_EXPORT_LIMITS.utf8Units
    )
      limit();
    const n = inspected.note;
    if (ids.has(n.id)) invalid();
    ids.add(n.id);
    // Export the Note contract, never unrelated engine/private object fields.
    const note: Note = {
      id: n.id,
      title: n.title,
      document: n.document,
      tags: n.tags,
      createdAt: n.createdAt,
      updatedAt: n.updatedAt,
      trashedAt: n.trashedAt,
      revision: n.revision,
    };
    // Admit serialization before constructing it. JSON string escaping costs
    // at most six ASCII bytes per metadata UTF16 unit; inspected document JSON
    // needs at most three UTF8 bytes per already-serialized unit.
    const metadataUnits =
      note.id.length +
      note.title.length +
      note.createdAt.length +
      note.updatedAt.length +
      (note.trashedAt?.length ?? 0) +
      note.tags.reduce((sum, tag) => sum + tag.length + 1, 0);
    reserve(inspected.jsonUnits * 3 + metadataUnits * 6 + 256);
    const encoded = JSON.stringify(note);
    serializedBytes += charge(encoded);
    serialized.push(encoded);
    // The estimate traverses and the formatter renders one bounded document.
    // Neither receives a fresh node allowance after owner/validation work.
    if (visits + inspected.nodeVisits * 2 > NOTE_EXPORT_LIMITS.nodeVisits)
      limit();
    visits += inspected.nodeVisits * 2;
    const rendered = renderMarkdownSnapshot(
      [note],
      (node) => {
        const target = validateNoteTarget(node.attrs?.target);
        const label = labels.get(key(target)) ?? "Note reference";
        let reference: string;
        try {
          reference = encodeNoteReference(target);
        } catch (failure) {
          if (
            !(failure instanceof NoteLinkError) ||
            ![
              "note_link_reference_too_large",
              "note_link_reference_unencodable",
            ].includes(failure.code)
          )
            throw failure;
          reference = JSON.stringify(target);
          warnings.add(
            "A target cannot be encoded as a portable link. Its exact identity is retained as JSON in Markdown and notes.json; it was not shortened or retargeted.",
          );
        }
        return `${escapeMarkdownText(label)} ${markdownCodeSpan(reference)}`;
      },
      {
        admit: reserve,
        startIndex: markdown.length,
        referenceBound: (node) => {
          const target = validateNoteTarget(node.attrs?.target);
          // Covers escaped current label, both transport/base64 layers OR exact
          // JSON fallback, and worst-case backtick fence expansion, before encode.
          return target.noteId.length * 8 + 4096;
        },
      },
    );
    markdown.push(...rendered);
  }
  const jsonPrefix = '{"format":"orbyn-notes-notes","version":1,"notes":[';
  reserve(
    jsonPrefix.length +
      2 +
      serializedBytes +
      Math.max(0, serialized.length - 1),
  );
  const json = `${jsonPrefix}${serialized.join(",")}]}`;
  const readmeLines = [
    "Orbyn Notes export",
    "",
    ...warnings,
    "",
    "Reference tokens identify an account, library epoch and note. They do not grant access.",
    "notes.json retains actual note IDs and structured documents for manual recovery. Automatic bundle import, account rebinding and graph restoration are not implemented.",
  ];
  reserve(readmeLines.reduce((sum, line) => sum + line.length * 3 + 1, 0));
  const readme = readmeLines.join("\n");
  return {
    files: [
      ...markdown,
      { filename: "notes.json", content: json },
      { filename: "README.txt", content: readme },
    ],
    warnings: [...warnings],
  };
}
