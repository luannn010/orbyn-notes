import type { NoteDocument } from "../domain/contracts";
import { validateNoteDocument } from "../domain/validation";
import { encodeNoteReference } from "../links/reference";
import type { NoteTarget } from "../links/contracts";
export const NOTE_FRAGMENT_MIME = "application/x-orbyn-notes-fragment-v1";
const MAX_FRAGMENT = 8 * 1024 * 1024;
function boundedUtf8(value: string) {
  if (value.length > MAX_FRAGMENT)
    throw Error("The note selection is too large.");
  let bytes = 0;
  for (let index = 0; index < value.length; index++) {
    const unit = value.charCodeAt(index);
    if (unit < 0x80) bytes++;
    else if (unit < 0x800) bytes += 2;
    else if (
      unit >= 0xd800 &&
      unit <= 0xdbff &&
      index + 1 < value.length &&
      value.charCodeAt(index + 1) >= 0xdc00 &&
      value.charCodeAt(index + 1) <= 0xdfff
    ) {
      bytes += 4;
      index++;
    } else bytes += 3;
    if (bytes > MAX_FRAGMENT) throw Error("The note selection is too large.");
  }
}
export function encodeNoteFragment(
  content: unknown,
  openStart: number,
  openEnd: number,
) {
  const document = validateNoteDocument({
    type: "doc",
    content: content ?? [],
  });
  const value = JSON.stringify({ version: 1, document, openStart, openEnd });
  boundedUtf8(value);
  return value;
}
export function decodeNoteFragment(value: string) {
  boundedUtf8(value);
  const parsed: unknown = JSON.parse(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw Error("Invalid note selection.");
  const raw = parsed as Record<string, unknown>;
  if (JSON.stringify(raw) !== value) throw Error("Invalid note selection.");
  if (
    Object.keys(raw).sort().join(",") !==
      "document,openEnd,openStart,version" ||
    raw.version !== 1 ||
    !Number.isSafeInteger(raw.openStart) ||
    !Number.isSafeInteger(raw.openEnd) ||
    (raw.openStart as number) < 0 ||
    (raw.openStart as number) > 32 ||
    (raw.openEnd as number) < 0 ||
    (raw.openEnd as number) > 32
  )
    throw Error("Invalid note selection.");
  return {
    document: validateNoteDocument(raw.document),
    openStart: raw.openStart as number,
    openEnd: raw.openEnd as number,
  };
}
export function referencePlainText(document: NoteDocument): string {
  const visit = (node: Record<string, unknown>): string => {
    if (node.type === "text") return String(node.text ?? "");
    if (node.type === "hardBreak") return "\n";
    if (node.type === "noteLink") {
      const target = (node.attrs as { target: NoteTarget }).target;
      let value: string;
      try {
        value = encodeNoteReference(target);
      } catch {
        value = JSON.stringify(target);
      }
      return `Note reference ${value}`;
    }
    const children = Array.isArray(node.content)
      ? (node.content as Record<string, unknown>[])
      : [];
    return children.map(visit).join(node.type === "doc" ? "\n" : "");
  };
  return visit(document as unknown as Record<string, unknown>);
}
