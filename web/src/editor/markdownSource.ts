import type { NoteDocument, RichNode } from "../domain/contracts";
import { validateNoteDocument } from "../domain/validation";
import {
  escapeMarkdownText,
  markdownCodeSpan,
  parseMarkdown,
} from "../transfer";
import { encodeNoteReference } from "../links/reference";
import type { NoteTarget } from "../links/contracts";

/** A source session owns references already admitted by the note, never arbitrary targets. */
export type MarkdownSource = {
  text: string;
  original: NoteDocument;
  references: Map<string, RichNode>;
};
const marker = "\uE000ORBYN";

function markdownDestination(href: string): string {
  // Markdown unescapes punctuation before URI normalization. Protect entities and
  // delimiters without percent-encoding characters that were literal in storage.
  const destination = href.replace(/[\\()<>&]/g, "\\$&");
  const parsed = parseMarkdown([
    { name: "Link.md", content: `\n[Link](${destination})` },
  ])[0]?.document.content[0]?.content?.[0]?.marks?.find(
    (mark) => mark.type === "link",
  );
  // The import parser normalizes some valid stored URLs (Unicode, backslashes,
  // angle brackets). Refuse source admission rather than retarget those links
  // after an unrelated edit; Rich view keeps the original document intact.
  if (parsed?.attrs?.href !== href)
    throw Error(
      "This link cannot be preserved as Markdown. Keep using Rich view.",
    );
  return destination;
}

export function createMarkdownSource(document: NoteDocument): MarkdownSource {
  const original = validateNoteDocument(document),
    references = new Map<string, RichNode>();
  const inline = (nodes: RichNode[] = []): string =>
    nodes
      .map((node) => {
        if (node.type === "hardBreak") return "  \n";
        if (node.type === "noteLink") {
          const token = `[[note:${encodeNoteReference(node.attrs?.target as NoteTarget)}]]`;
          references.set(token, structuredClone(node));
          return token;
        }
        if (node.type !== "text")
          throw Error(
            "This content cannot be edited as Markdown. Keep using Rich view.",
          );
        let text = escapeMarkdownText(node.text ?? "");
        for (const mark of node.marks ?? []) {
          if (mark.type === "bold") text = `**${text}**`;
          else if (mark.type === "italic") text = `*${text}*`;
          else if (mark.type === "strike") text = `~~${text}~~`;
          else if (mark.type === "code")
            text = markdownCodeSpan(node.text ?? "");
          else if (mark.type === "link")
            text = `[${text}](${markdownDestination(String(mark.attrs?.href))})`;
          else
            throw Error(
              "This formatting cannot be edited as Markdown. Keep using Rich view.",
            );
        }
        return text;
      })
      .join("");
  const blocks = (nodes: RichNode[] = []): string =>
    nodes
      .map((node) => {
        if (node.type === "paragraph") return inline(node.content);
        if (node.type === "heading")
          return `${"#".repeat(Number(node.attrs?.level) || 2)} ${inline(node.content)}`;
        if (node.type === "horizontalRule") return "---";
        if (node.type === "blockquote")
          return blocks(node.content)
            .split("\n")
            .map((line) => `> ${line}`)
            .join("\n");
        if (node.type === "codeBlock") {
          const text =
            node.content?.map((child) => child.text ?? "").join("") ?? "";
          const fence = "`".repeat(
            Math.max(
              3,
              ...[...text.matchAll(/`+/g)].map((match) => match[0].length + 1),
            ),
          );
          return `${fence}${String(node.attrs?.language ?? "")}\n${text}\n${fence}`;
        }
        if (["bulletList", "orderedList", "taskList"].includes(node.type))
          return (node.content ?? [])
            .map((item, i) => {
              const prefix =
                node.type === "orderedList"
                  ? `${Number(node.attrs?.start ?? 1) + i}. `
                  : node.type === "taskList"
                    ? `- [${item.attrs?.checked ? "x" : " "}] `
                    : "- ";
              return blocks(item.content)
                .split("\n")
                .map((line, index) =>
                  index ? " ".repeat(prefix.length) + line : prefix + line,
                )
                .join("\n");
            })
            .join("\n");
        throw Error(
          "This content cannot be edited as Markdown. Keep using Rich view.",
        );
      })
      .join("\n\n");
  const text = blocks(original.content);
  if (text.includes(marker))
    throw Error(
      "This content cannot be edited as Markdown. Keep using Rich view.",
    );
  return { text, original, references };
}

export function parseMarkdownSource(
  text: string,
  source?: MarkdownSource,
): NoteDocument {
  if (source && text === source.text) return structuredClone(source.original);
  if (text.includes(marker))
    throw Error(
      "Unsupported source marker. Your Markdown draft is still here.",
    );
  // Images and tables must never be silently flattened by the import codec.
  if (/(^|[^\\])!\[/.test(text) || /^\s*\|.*\|\s*$/m.test(text))
    throw Error(
      "Images and tables are not supported. Your Markdown draft is still here.",
    );
  const references: RichNode[] = [];
  const body = text.replace(/(?<!\\)\[\[note:[^\]\n]+\]\]/g, (token) => {
    const node = source?.references.get(token);
    if (!node)
      throw Error(
        "Choose note links in Rich view. Unknown reference tokens cannot be saved.",
      );
    references.push(node);
    return `${marker}${references.length - 1}\uE001`;
  });
  // Leading newline prevents body horizontal rules being interpreted as file front matter.
  const document = parseMarkdown([
    { name: "Note.md", content: `\n${body}` },
  ])[0]!.document;
  const restore = (nodes: RichNode[]): RichNode[] =>
    nodes.flatMap((node) => {
      if (node.type === "text" && !node.text) return [];
      if (node.type === "text" && node.text?.includes(marker)) {
        if (node.marks?.length)
          throw Error(
            "Note-link tokens cannot have inline formatting. Your source draft is still here.",
          );
        const result: RichNode[] = [],
          matcher = /\uE000ORBYN(\d+)\uE001/g;
        let start = 0;
        for (const match of node.text.matchAll(matcher)) {
          if (match.index > start)
            result.push({
              type: "text",
              text: node.text.slice(start, match.index),
            });
          result.push(structuredClone(references[Number(match[1])]!));
          start = match.index + match[0].length;
        }
        if (start < node.text.length)
          result.push({ type: "text", text: node.text.slice(start) });
        return result;
      }
      if (node.content) node.content = restore(node.content);
      return [node];
    });
  document.content = restore(document.content);
  return validateNoteDocument(document);
}
