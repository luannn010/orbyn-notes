import MarkdownIt from "markdown-it";

import type { Note, NoteDocument, RichNode } from "../domain/contracts";
import { safeHref, validateInput } from "../domain/validation";
const parser = new MarkdownIt({
  html: false,
  linkify: false,
  typographer: false,
});
type Token = ReturnType<typeof parser.parse>[number];
export const MAX_MARKDOWN_FILE_BYTES = 2_000_000;
export const MAX_MARKDOWN_BATCH_BYTES = 10_000_000;
export const MAX_MARKDOWN_FILES = 100;
function inline(tokens: Token[], filename: string): RichNode[] {
  const nodes: RichNode[] = [];
  let marks: NonNullable<RichNode["marks"]> = [];
  for (const token of tokens) {
    if (token.type === "text" && token.content)
      nodes.push({
        type: "text",
        text: token.content,
        ...(marks.length ? { marks: structuredClone(marks) } : {}),
      });
    else if (token.type === "code_inline" && token.content)
      nodes.push({
        type: "text",
        text: token.content,
        marks: [...structuredClone(marks), { type: "code" }],
      });
    else if (token.type === "softbreak")
      nodes.push({ type: "text", text: "\n" });
    else if (token.type === "hardbreak") nodes.push({ type: "hardBreak" });
    else if (token.type === "image")
      throw new Error(
        `unsupported_image: ${JSON.stringify(filename)} contains an image, which is not supported yet. Keep the image and its URL separately before importing. Nothing was imported.`,
      );
    else if (token.type.endsWith("_open")) {
      const kind: Record<string, string> = {
        strong_open: "bold",
        em_open: "italic",
        s_open: "strike",
        link_open: "link",
      };
      const type = kind[token.type];
      if (type) {
        if (type === "link") {
          const href = token.attrGet("href");
          if (!safeHref(href))
            throw new Error(
              "unsafe_link: Only HTTPS, HTTP and email links are supported.",
            );
          marks.push({ type, attrs: { href } });
        } else marks.push({ type });
      }
    } else if (token.type.endsWith("_close")) marks = marks.slice(0, -1);
  }
  return nodes;
}
function document(tokens: Token[], filename: string): NoteDocument {
  if (tokens.some((token) => token.type === "table_open"))
    throw new Error(
      `unsupported_table: ${JSON.stringify(filename)} contains a Markdown table, which is not supported yet. Convert the table to text before importing. Nothing was imported.`,
    );
  const root: NoteDocument = { type: "doc", content: [] };
  const stack: RichNode[] = [root];
  const taskMarkers = new WeakMap<RichNode, RegExpExecArray>();
  const kinds: Record<string, string> = {
    paragraph_open: "paragraph",
    heading_open: "heading",
    bullet_list_open: "bulletList",
    ordered_list_open: "orderedList",
    list_item_open: "listItem",
    blockquote_open: "blockquote",
  };
  for (const token of tokens) {
    const parent = stack[stack.length - 1]!;
    if (kinds[token.type]) {
      const node: RichNode = { type: kinds[token.type]!, content: [] };
      if (node.type === "heading")
        node.attrs = { level: Number(token.tag.slice(1)) };
      if (node.type === "orderedList")
        node.attrs = { start: Number(token.attrGet("start") ?? 1) };
      parent.content!.push(node);
      stack.push(node);
    } else if (token.type.endsWith("_close")) stack.pop();
    else if (token.type === "inline") {
      const item = stack.at(-2);
      if (
        parent.type === "paragraph" &&
        item?.type === "listItem" &&
        item.content?.[0] === parent &&
        stack.at(-3)?.type === "bulletList"
      ) {
        // Parsed text also contains escaped/marked literals. Only a source
        // marker followed by whitespace or end-of-line admits a task item.
        const marker = /^\[([ xX])\](?:[ \t]|(?=\n|$))/.exec(token.content);
        if (marker) taskMarkers.set(item, marker);
      }
      parent.content!.push(...inline(token.children ?? [], filename));
    } else if (["fence", "code_block"].includes(token.type)) {
      // A fence holding only a blank line yields "\n" and would leave an empty
      // text node, which the editor schema cannot load.
      const text = token.content.replace(/\n$/, "");
      parent.content!.push({
        type: "codeBlock",
        attrs: { language: token.info.trim().split(/\s/)[0] || null },
        content: text ? [{ type: "text", text }] : [],
      });
    } else if (token.type === "hr")
      parent.content!.push({ type: "horizontalRule" });
  }
  function tasks(nodes: RichNode[]): RichNode[] {
    return nodes.flatMap((node) => {
      if (node.content) node.content = tasks(node.content);
      if (node.type !== "bulletList") return [node];
      const groups: RichNode[] = [];
      for (const item of node.content ?? []) {
        const text = item.content?.[0]?.content?.[0];
        const marker = taskMarkers.get(item);
        const match =
          marker && !text?.marks?.length && text?.text?.startsWith(marker[0])
            ? marker
            : null;
        const type = match ? "taskList" : "bulletList";
        if (match) {
          item.type = "taskItem";
          item.attrs = { checked: match[1] !== " " };
          text!.text = text!.text!.slice(match[0].length);
          if (!text!.text) item.content![0]!.content!.shift();
        }
        let group = groups[groups.length - 1];
        if (group?.type !== type) {
          group = { type, content: [] };
          groups.push(group);
        }
        group.content!.push(item);
      }
      return groups;
    });
  }
  root.content = tasks(root.content);
  return root.content.length
    ? root
    : { type: "doc", content: [{ type: "paragraph", content: [] }] };
}
function frontmatter(
  source: string,
  filename: string,
): {
  body: string;
  title?: string;
  tags: string[];
} {
  if (!source.startsWith("---\n")) return { body: source, tags: [] };
  const closing = /^---(?:\n|$)/gm;
  closing.lastIndex = 4;
  const delimiter = closing.exec(source);
  const end = delimiter?.index ?? -1;
  if (end < 0 || end - 1 > 10000)
    throw new Error(
      `invalid_frontmatter: ${JSON.stringify(filename)}: Use a closed title/tags front matter block.`,
    );
  const result: { body: string; title?: string; tags: string[] } = {
    body: source.slice(end + delimiter![0].length),
    tags: [],
  };
  const seen = new Set<string>();
  for (const line of source.slice(4, end).split("\n")) {
    if (!line.trim()) continue;
    const match = /^(title|tags):\s*(.*)$/.exec(line);
    if (!match || seen.has(match[1]!))
      throw new Error(
        `invalid_frontmatter: ${JSON.stringify(filename)}: Only title and tags are supported.`,
      );
    seen.add(match[1]!);
    let value: unknown;
    try {
      value = JSON.parse(match[2]!);
    } catch {
      throw new Error(
        `invalid_frontmatter: ${JSON.stringify(filename)}: title and tags must use JSON strings and arrays.`,
      );
    }
    if (match[1] === "title") {
      if (typeof value !== "string")
        throw new Error(
          `invalid_frontmatter: ${JSON.stringify(filename)}: Invalid title.`,
        );
      result.title = value;
    } else {
      if (!Array.isArray(value) || value.some((v) => typeof v !== "string"))
        throw new Error(
          `invalid_frontmatter: ${JSON.stringify(filename)}: Invalid tags.`,
        );
      result.tags = value;
    }
  }
  return result;
}
export function parseMarkdown(
  files: Array<{ name: string; content: string }>,
): Array<{ title: string; document: NoteDocument; tags: string[] }> {
  if (files.length > MAX_MARKDOWN_FILES)
    throw new Error("too_many_files: Import at most 100 files at once.");
  let total = 0;
  return files.map((file) => {
    if (
      typeof file.name !== "string" ||
      typeof file.content !== "string" ||
      !/\.(?:md|markdown|mdown)$/i.test(file.name)
    )
      throw new Error("invalid_file: Choose Markdown files.");
    if (!file.content.trim())
      throw new Error(
        `invalid_file: ${JSON.stringify(file.name)} is empty. Nothing was imported.`,
      );
    const size = new TextEncoder().encode(file.content).length;
    total += size;
    if (size > MAX_MARKDOWN_FILE_BYTES || total > MAX_MARKDOWN_BATCH_BYTES)
      throw new Error(
        "file_too_large: Import files up to 2 MB and batches up to 10 MB.",
      );
    if (file.content.includes("\0"))
      throw new Error("invalid_file: Binary files cannot be imported.");
    const front = frontmatter(
      file.content.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n"),
      file.name,
    );
    const doc = document(parser.parse(front.body, {}), file.name);
    const heading = doc.content.find((n) => n.type === "heading");
    return validateInput({
      title:
        front.title ??
        heading?.content?.map((n) => n.text ?? "").join("") ??
        file.name.replace(/\.(?:md|markdown|mdown)$/i, ""),
      document: doc,
      tags: front.tags,
    });
  });
}
export function escapeMarkdownText(text: string): string {
  return (
    text
      .replace(/&/g, "&amp;")
      .replace(/([\\`*_[\]<>#~!|+=-])/g, "\\$1")
      .replace(/^(\d+)([.)])(?=\s)/, "$1\\$2")
      .replace(/^([.)])(?=\s)/, "\\$1")
      // Entities keep literal whitespace inside one paragraph instead of creating
      // indented code, a new block, a hard break, or a trimmed paragraph boundary.
      .replace(/^[ \t]+|[ \t]+$/g, (value) =>
        value.replace(/ /g, "&#32;").replace(/\t/g, "&#9;"),
      )
      .replace(/\t/g, "&#9;")
      .replace(/\r/g, "&#13;")
      .replace(/\n/g, "&#10;")
  );
}
// Body lines can use readable soft breaks. Edges and consecutive newlines need
// entities so Markdown does not trim them or split a single paragraph in two.
function escapeMarkdownBodyText(
  text: string,
  before: string | undefined,
  after: string | undefined,
  guardStart = false,
  guardEnd = false,
): string {
  let prefix = "",
    suffix = "";
  // An entity at a marked run's edge is punctuation in Markdown source. Fence
  // its plain neighbor too so the adjacent mark delimiter can open or close.
  if (guardStart && text.length) {
    const point = text.codePointAt(0)!;
    const first = String.fromCodePoint(point);
    prefix = `&#${point};`;
    before = first.at(-1);
    text = text.slice(first.length);
  }
  if (guardEnd && text.length) {
    let start = text.length - 1;
    if (
      start > 0 &&
      /[\uDC00-\uDFFF]/.test(text[start]!) &&
      /[\uD800-\uDBFF]/.test(text[start - 1]!)
    )
      start--;
    const last = text.slice(start);
    suffix = `&#${last.codePointAt(0)};`;
    after = last[0];
    text = text.slice(0, start);
  }
  let offset = 0;
  const body = text
    .split("\n")
    .map((line, index) => {
      const escaped = escapeMarkdownText(line);
      if (index === 0) {
        offset = line.length;
        return escaped;
      }
      const previous = text[offset - 1] ?? before;
      const next = text[offset + 1] ?? after;
      offset += line.length + 1;
      return `${previous && next && previous !== "\n" && next !== "\n" ? "\n" : "&#10;"}${escaped}`;
    })
    .join("");
  return prefix + body + suffix;
}

type MarkdownLoss =
  "underline" | "adjacent lists" | "empty paragraphs" | "code line breaks";
const markdownLossMessages: Record<MarkdownLoss, string> = {
  underline: "Markdown cannot preserve underline formatting.",
  "code line breaks":
    "Markdown cannot preserve code line breaks in inline code.",
  "adjacent lists": "Markdown can merge adjacent lists of the same kind.",
  "empty paragraphs": "Markdown cannot preserve these empty paragraphs.",
};
export class UnsupportedMarkdownExportError extends Error {
  constructor(reason: MarkdownLoss) {
    super(
      `unsupported_markdown_export: ${markdownLossMessages[reason]} Your notes were not changed.`,
    );
  }
}
type ReportMarkdownLoss = (reason: MarkdownLoss) => void;
const rejectMarkdownLoss: ReportMarkdownLoss = (reason) => {
  throw new UnsupportedMarkdownExportError(reason);
};
export function markdownCodeSpan(text: string): string {
  let longest = 0;
  for (const match of text.matchAll(/`+/g))
    longest = Math.max(longest, match[0].length);
  const fence = "`".repeat(longest + 1);
  return `${fence} ${text} ${fence}`;
}
type MarkdownExtent = { bytes: number; newlines: number };
export type MarkdownAdmission = {
  admit: (upperUtf8Bytes: number) => void;
  referenceBound: (node: RichNode) => number;
  startIndex?: number;
};
const lineCount = (text: string) => {
  let count = 0;
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) count++;
  return count;
};
function inlineExtent(
  nodes: RichNode[],
  reference: (node: RichNode) => number,
): MarkdownExtent {
  let bytes = 0,
    newlines = 0;
  for (const node of nodes) {
    if (node.type === "hardBreak") {
      bytes += 3;
      newlines++;
      continue;
    }
    if (node.type === "noteLink") {
      bytes += reference(node);
      continue;
    }
    const text = node.text ?? "";
    bytes += text.length * 6 + 4;
    newlines += lineCount(text);
    for (const mark of node.marks ?? [])
      bytes +=
        4 +
        (mark.type === "link" ? String(mark.attrs?.href ?? "").length * 3 : 0);
  }
  return { bytes, newlines };
}
/** An upper output bound is computed before any escaped/fenced output exists.
 * Newline counts stay separate: indentation does not multiply line counts. */
function blockExtent(
  nodes: RichNode[],
  reference: (node: RichNode) => number,
): MarkdownExtent {
  let bytes = Math.max(0, nodes.length - 1) * 2;
  let newlines = bytes;
  for (const node of nodes) {
    const children = node.content ?? [];
    let value: MarkdownExtent;
    if (node.type === "paragraph" || node.type === "heading") {
      value = inlineExtent(children, reference);
      if (node.type === "heading") value.bytes += 7;
    } else if (node.type === "horizontalRule")
      value = { bytes: 3, newlines: 0 };
    else if (node.type === "codeBlock") {
      let size = 0,
        lines = 2;
      for (const child of children) {
        size += (child.text ?? "").length;
        lines += lineCount(child.text ?? "");
      }
      value = {
        bytes: size * 5 + 8 + String(node.attrs?.language ?? "").length * 3,
        newlines: lines,
      };
    } else if (["bulletList", "orderedList", "taskList"].includes(node.type)) {
      value = {
        bytes: Math.max(0, children.length - 1),
        newlines: Math.max(0, children.length - 1),
      };
      for (let i = 0; i < children.length; i++) {
        const child = blockExtent(children[i]!.content ?? [], reference);
        /** Mirrors the renderer: marker on line one, content column after. */
        const marker =
          node.type === "orderedList"
            ? `${(Number(node.attrs?.start) || 1) + i}. `.length
            : node.type === "taskList"
              ? 6
              : 2;
        const indent = node.type === "orderedList" ? marker : 2;
        value.bytes += child.bytes + marker + indent * child.newlines;
        value.newlines += child.newlines;
      }
    } else {
      value = blockExtent(children, reference);
      if (node.type === "blockquote") value.bytes += 2 * (value.newlines + 1);
    }
    bytes += value.bytes;
    newlines += value.newlines;
  }
  return { bytes, newlines };
}
/** Whitespace at the edge of a marked run belongs outside its delimiters: a
 * closing `**` after an encoded space is not right-flanking, so re-import would
 * show the asterisks. */
function splitEdgeWhitespace(text: string): {
  leading: string;
  core: string;
  trailing: string;
} {
  const leading = /^[ \t]*/.exec(text)![0];
  const rest = text.slice(leading.length);
  const trailing = /[ \t]*$/.exec(rest)![0];
  return { leading, core: rest.slice(0, rest.length - trailing.length), trailing };
}
/** Markdown trims literal whitespace at block and hard-break line edges. */
function escapeEdgeWhitespace(whitespace: string): string {
  return whitespace.replace(/ /g, "&#32;").replace(/\t/g, "&#9;");
}
function renderInline(
  nodes: RichNode[] = [],
  reference?: (node: RichNode) => string,
  reportLoss: ReportMarkdownLoss = rejectMarkdownLoss,
  bodyLines = false,
): string {
  const edge = (node: RichNode | undefined, last: boolean) => {
    if (node?.type === "hardBreak") return "\n";
    if (node?.type === "noteLink") return "\ufffc";
    return last ? node?.text?.at(-1) : node?.text?.[0];
  };
  return nodes
    .map((n, index) => {
      if (n.type === "hardBreak") return "  \n";
      if (n.type === "noteLink") {
        if (!reference)
          throw new Error(
            "invalid_document: A note reference needs an authorized export projection.",
          );
        return reference(n);
      }
      const raw = n.text ?? "";
      const marks = n.marks ?? [];
      const guardStart = !!nodes[index - 1]?.marks?.length &&
        !!nodes[index - 1]?.text?.endsWith("\n");
      const guardEnd = !!nodes[index + 1]?.marks?.length &&
        !!nodes[index + 1]?.text?.startsWith("\n");
      // Preserve the body serializer's neighboring-newline behavior.
      if (bodyLines && !marks.length && (raw.includes("\n") || guardStart || guardEnd))
        return escapeMarkdownBodyText(raw, edge(nodes[index - 1], true),
          edge(nodes[index + 1], false), guardStart, guardEnd);
      const emphasis = marks.some((mark) =>
        ["bold", "italic", "strike"].includes(mark.type),
      );
      const linked = marks.some((mark) => mark.type === "link");
      const whitespaceOnly = /^[ \t]*$/.test(raw);
      // Link labels retain their full linked range; code spans retain their own padding.
      const whitespace = marks.some((mark) => mark.type === "code") ||
        (linked && (!emphasis || whitespaceOnly))
        ? null
        : splitEdgeWhitespace(raw);
      // A code span is literal source text, so it is the base the other marks
      // wrap. Applying it inside the loop below replaced any `**`/`*`/`~~` or
      // link already added, silently losing that formatting on export.
      let text: string;
      if (marks.some((mark) => mark.type === "code")) {
        if (/[\r\n]/.test(raw)) reportLoss("code line breaks");
        text = markdownCodeSpan(raw);
      } else {
        text = escapeMarkdownText(whitespace ? whitespace.core : raw);
        if (whitespace && whitespace.core === "") text = escapeMarkdownText(raw);
      }
      let linkHref: string | undefined;
      for (const mark of marks) {
        if (mark.type === "code") continue;
        if (mark.type === "bold" && !whitespaceOnly) text = `**${text}**`;
        else if (mark.type === "italic" && !whitespaceOnly) text = `*${text}*`;
        else if (mark.type === "strike" && !whitespaceOnly) text = `~~${text}~~`;
        else if (mark.type === "underline") reportLoss("underline");
        else if (mark.type === "link") {
          if (!safeHref(mark.attrs?.href))
            throw new Error("unsafe_link: Invalid link.");
          const href = String(mark.attrs.href).replace(/\(/g, "%28").replace(/\)/g, "%29");
          if (whitespace && whitespace.core !== "") linkHref = href;
          else text = `[${text}](${href})`;
        }
      }
      if (!whitespace || whitespace.core === "") return text;
      const leading =
        linked || index === 0 || edge(nodes[index - 1], true) === "\n"
          ? escapeEdgeWhitespace(whitespace.leading)
          : whitespace.leading;
      const trailing =
        linked || index === nodes.length - 1 || edge(nodes[index + 1], false) === "\n"
          ? escapeEdgeWhitespace(whitespace.trailing)
          : whitespace.trailing;
      const label = leading + text + trailing;
      return linkHref === undefined ? label : `[${label}](${linkHref})`;
    })
    .join("");
}
function renderBlocks(
  nodes: RichNode[] = [],
  reference?: (node: RichNode) => string,
  reportLoss: ReportMarkdownLoss = rejectMarkdownLoss,
  parent = "doc",
): string {
  return nodes
    .map((n, index) => {
      const children = n.content ?? [];
      if (
        ["bulletList", "orderedList", "taskList"].includes(n.type) &&
        nodes[index - 1]?.type === n.type
      )
        reportLoss("adjacent lists");
      switch (n.type) {
        case "paragraph":
          if (
            children.length === 0 &&
            !(nodes.length === 1 && (parent === "doc" || parent === "taskItem"))
          )
            reportLoss("empty paragraphs");
          return renderInline(children, reference, reportLoss, true);
        case "heading":
          return `${"#".repeat(Math.max(1, Math.min(6, Number(n.attrs?.level) || 1)))} ${renderInline(children, reference, reportLoss)}`;
        case "horizontalRule":
          return "---";
        case "blockquote":
          return renderBlocks(children, reference, reportLoss, n.type)
            .split("\n")
            .map((l) => `> ${l}`)
            .join("\n");
        case "codeBlock": {
          const text = children.map((c) => c.text ?? "").join("");
          let longest = 2;
          for (const match of text.matchAll(/`+/g))
            longest = Math.max(longest, match[0].length);
          const fence = "`".repeat(longest + 1);
          const language = String(n.attrs?.language ?? "").replace(
            /[^a-zA-Z0-9_+-]/g,
            "",
          );
          return `${fence}${language}\n${text}\n${fence}`;
        }
        case "bulletList":
        case "orderedList":
        case "taskList":
          return children
            .map((item, index) => {
              /** First-line marker; `[x] ` is content, not item indentation. */
              const marker =
                n.type === "orderedList"
                  ? `${(Number(n.attrs?.start) || 1) + index}. `
                  : n.type === "taskList"
                    ? `- [${item.attrs?.checked ? "x" : " "}] `
                    : "- ";
              /** The column a nested block must reach to stay in this item. */
              const indent = n.type === "orderedList" ? marker.length : 2;
              return renderBlocks(
                item.content,
                reference,
                reportLoss,
                item.type,
              )
                .split("\n")
                .map((line, i) =>
                  i === 0 ? marker + line : " ".repeat(indent) + line,
                )
                .join("\n");
            })
            .join("\n");
        default:
          return renderBlocks(children, reference, reportLoss, n.type);
      }
    })
    .join("\n\n");
}
export function exportMarkdown(
  notes: Note[],
): Array<{ filename: string; content: string }> {
  for (const note of notes) validateInput(note);
  return renderMarkdownSnapshot(notes);
}
/** Pure formatter only. Callers must validate and authorize their own snapshot. */
export function renderMarkdownSnapshot(
  notes: readonly Note[],
  reference?: (node: RichNode) => string,
  admission?: MarkdownAdmission,
  reportLoss: ReportMarkdownLoss = rejectMarkdownLoss,
): Array<{ filename: string; content: string }> {
  return notes.map((note, index) => {
    admission?.admit(
      blockExtent(note.document.content, admission.referenceBound).bytes +
        note.title.length * 6 +
        note.tags.reduce((sum, tag) => sum + tag.length * 6 + 4, 0) +
        128,
    );
    const name =
      (note.title || "Untitled")
        .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
        .replace(/[. ]+$/g, "")
        .slice(0, 100)
        .replace(/[\uD800-\uDBFF]$/, "") || "Untitled";
    return {
      filename: `${name}-${index + (admission?.startIndex ?? 0) + 1}.md`,
      content: `---\ntitle: ${JSON.stringify(note.title)}\ntags: ${JSON.stringify(note.tags)}\n---\n\n${renderBlocks(note.document.content, reference, reportLoss)}\n`,
    };
  });
}
