import MarkdownIt from "markdown-it";

import type { Note, NoteDocument, RichNode } from "../domain/contracts";
import { safeHref, validateInput } from "../domain/validation";
const parser = new MarkdownIt({
  html: false,
  linkify: false,
  typographer: false,
});
type Token = ReturnType<typeof parser.parse>[number];
const MAX_FILE_BYTES = 2_000_000;
function inline(tokens: Token[]): RichNode[] {
  const nodes: RichNode[] = [];
  let marks: NonNullable<RichNode["marks"]> = [];
  for (const token of tokens) {
    if (token.type === "text")
      nodes.push({
        type: "text",
        text: token.content,
        ...(marks.length ? { marks: structuredClone(marks) } : {}),
      });
    else if (token.type === "code_inline")
      nodes.push({
        type: "text",
        text: token.content,
        marks: [...structuredClone(marks), { type: "code" }],
      });
    else if (token.type === "softbreak")
      nodes.push({ type: "text", text: "\n" });
    else if (token.type === "hardbreak") nodes.push({ type: "hardBreak" });
    else if (token.type === "image")
      nodes.push({ type: "text", text: token.content });
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
function document(tokens: Token[]): NoteDocument {
  const root: NoteDocument = { type: "doc", content: [] };
  const stack: RichNode[] = [root];
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
    else if (token.type === "inline")
      parent.content!.push(...inline(token.children ?? []));
    else if (["fence", "code_block"].includes(token.type))
      parent.content!.push({
        type: "codeBlock",
        attrs: { language: token.info.trim().split(/\s/)[0] || null },
        content: token.content
          ? [{ type: "text", text: token.content.replace(/\n$/, "") }]
          : [],
      });
    else if (token.type === "hr")
      parent.content!.push({ type: "horizontalRule" });
  }
  function tasks(node: RichNode) {
    node.content?.forEach(tasks);
    if (
      node.type === "bulletList" &&
      node.content?.some((item) =>
        /^\[[ xX]\] /.test(item.content?.[0]?.content?.[0]?.text ?? ""),
      )
    ) {
      node.type = "taskList";
      for (const item of node.content ?? []) {
        item.type = "taskItem";
        const text = item.content?.[0]?.content?.[0];
        const match = /^\[([ xX])\] /.exec(text?.text ?? "");
        item.attrs = { checked: !!match && match[1] !== " " };
        if (match && text?.text) text.text = text.text.slice(match[0].length);
      }
    }
  }
  root.content.forEach(tasks);
  return root.content.length
    ? root
    : { type: "doc", content: [{ type: "paragraph", content: [] }] };
}
function frontmatter(source: string): {
  body: string;
  title?: string;
  tags: string[];
} {
  if (!source.startsWith("---\n")) return { body: source, tags: [] };
  const end = source.indexOf("\n---\n", 4);
  if (end < 0 || end > 10000)
    throw new Error(
      "invalid_frontmatter: Use a closed title/tags front matter block.",
    );
  const result: { body: string; title?: string; tags: string[] } = {
    body: source.slice(end + 5),
    tags: [],
  };
  const seen = new Set<string>();
  for (const line of source.slice(4, end).split("\n")) {
    if (!line.trim()) continue;
    const match = /^(title|tags):\s*(.*)$/.exec(line);
    if (!match || seen.has(match[1]!))
      throw new Error(
        "invalid_frontmatter: Only title and tags are supported.",
      );
    seen.add(match[1]!);
    let value: unknown;
    try {
      value = JSON.parse(match[2]!);
    } catch {
      throw new Error(
        "invalid_frontmatter: title and tags must use JSON strings and arrays.",
      );
    }
    if (match[1] === "title") {
      if (typeof value !== "string")
        throw new Error("invalid_frontmatter: Invalid title.");
      result.title = value;
    } else {
      if (!Array.isArray(value) || value.some((v) => typeof v !== "string"))
        throw new Error("invalid_frontmatter: Invalid tags.");
      result.tags = value;
    }
  }
  return result;
}
export function parseMarkdown(
  files: Array<{ name: string; content: string }>,
): Array<{ title: string; document: NoteDocument; tags: string[] }> {
  if (files.length > 100)
    throw new Error("too_many_files: Import at most 100 files at once.");
  let total = 0;
  return files.map((file) => {
    if (
      typeof file.name !== "string" ||
      typeof file.content !== "string" ||
      !/\.(?:md|markdown|mdown)$/i.test(file.name)
    )
      throw new Error("invalid_file: Choose Markdown files.");
    const size = new TextEncoder().encode(file.content).length;
    total += size;
    if (size > MAX_FILE_BYTES || total > 10_000_000)
      throw new Error(
        "file_too_large: Import files up to 2 MB and batches up to 10 MB.",
      );
    if (file.content.includes("\0"))
      throw new Error("invalid_file: Binary files cannot be imported.");
    const front = frontmatter(
      file.content.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n"),
    );
    const doc = document(parser.parse(front.body, {}));
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
function escape(text: string): string {
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
function renderInline(nodes: RichNode[] = []): string {
  return nodes
    .map((n) => {
      if (n.type === "hardBreak") return "  \n";
      let text = escape(n.text ?? "");
      for (const mark of n.marks ?? []) {
        if (mark.type === "bold") text = `**${text}**`;
        else if (mark.type === "italic") text = `*${text}*`;
        else if (mark.type === "strike") text = `~~${text}~~`;
        else if (mark.type === "code") {
          const fence = "`".repeat(
            Math.max(
              0,
              ...((n.text ?? "").match(/`+/g) ?? []).map((x) => x.length),
            ) + 1,
          );
          text = `${fence} ${n.text ?? ""} ${fence}`;
        } else if (mark.type === "link") {
          if (!safeHref(mark.attrs?.href))
            throw new Error("unsafe_link: Invalid link.");
          text = `[${text}](${String(mark.attrs.href).replace(/\(/g, "%28").replace(/\)/g, "%29")})`;
        }
      }
      return text;
    })
    .join("");
}
function renderBlocks(nodes: RichNode[] = []): string {
  return nodes
    .map((n) => {
      const children = n.content ?? [];
      switch (n.type) {
        case "paragraph":
          return renderInline(children);
        case "heading":
          return `${"#".repeat(Math.max(1, Math.min(6, Number(n.attrs?.level) || 1)))} ${renderInline(children)}`;
        case "horizontalRule":
          return "---";
        case "blockquote":
          return renderBlocks(children)
            .split("\n")
            .map((l) => `> ${l}`)
            .join("\n");
        case "codeBlock": {
          const text = children.map((c) => c.text ?? "").join("");
          const fence = "`".repeat(
            Math.max(2, ...(text.match(/`+/g) ?? []).map((s) => s.length)) + 1,
          );
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
              const prefix =
                n.type === "orderedList"
                  ? `${(Number(n.attrs?.start) || 1) + index}. `
                  : n.type === "taskList"
                    ? `- [${item.attrs?.checked ? "x" : " "}] `
                    : "- ";
              return renderBlocks(item.content)
                .split("\n")
                .map((line, i) =>
                  i === 0 ? prefix + line : " ".repeat(prefix.length) + line,
                )
                .join("\n");
            })
            .join("\n");
        default:
          return renderBlocks(children);
      }
    })
    .join("\n\n");
}
export function exportMarkdown(
  notes: Note[],
): Array<{ filename: string; content: string }> {
  return notes.map((note, index) => {
    validateInput(note);
    const name =
      (note.title || "Untitled")
        .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
        .replace(/[. ]+$/g, "")
        .slice(0, 100) || "Untitled";
    return {
      filename: `${name}-${index + 1}.md`,
      content: `---\ntitle: ${JSON.stringify(note.title)}\ntags: ${JSON.stringify(note.tags)}\n---\n\n${renderBlocks(note.document.content)}\n`,
    };
  });
}
