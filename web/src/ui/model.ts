import type { Note, RichNode } from "../domain/contracts";
import { safeHref } from "../domain/validation";
// Adjacent text nodes stay one run, so a word split by a mark keeps its
// spelling; blocks, hard breaks and leaves keep the space plain text had.
function runs(node: RichNode): string[] {
  if (node.type === "text") return node.text ? [node.text] : [];
  if (node.type === "hardBreak") return [];
  const result: string[] = [];
  let run = "";
  for (const child of node.content ?? []) {
    if (child.type === "text") {
      run += child.text ?? "";
      continue;
    }
    if (run) {
      result.push(run);
      run = "";
    }
    result.push(...runs(child));
  }
  if (run) result.push(run);
  return result;
}
export function plainText(node: RichNode): string {
  return runs(node).join(" ");
}
export function projectNotes(
  notes: Note[],
  query: string,
  tag: string,
  trash: boolean,
): Note[] {
  const needle = query.trim().toLocaleLowerCase();
  return notes
    .filter(
      (n) =>
        Boolean(n.trashedAt) === trash &&
        (!tag || n.tags.includes(tag)) &&
        (!needle ||
          `${n.title} ${plainText(n.document)} ${n.tags.join(" ")}`
            .toLocaleLowerCase()
            .includes(needle)),
    )
    .sort(
      (a, b) =>
        b.updatedAt.localeCompare(a.updatedAt) ||
        a.title.localeCompare(b.title) ||
        a.id.localeCompare(b.id),
    );
}
export function safeLink(value: string): boolean {
  if (!safeHref(value)) return false;
  try {
    return ["https:", "http:", "mailto:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}
export function message(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Something went wrong. Please try again.";
}
