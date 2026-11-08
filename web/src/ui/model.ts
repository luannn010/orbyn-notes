import type { Note, RichNode } from "../domain/contracts";
export function plainText(node: RichNode): string {
  return [node.text ?? "", ...(node.content ?? []).map(plainText)].join(" ");
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
