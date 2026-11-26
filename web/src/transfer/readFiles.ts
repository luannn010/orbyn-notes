import {
  MAX_MARKDOWN_BATCH_BYTES,
  MAX_MARKDOWN_FILE_BYTES,
  MAX_MARKDOWN_FILES,
  parseMarkdown,
} from "./index";

type MarkdownFile = {
  name: string;
  size: number;
  text(): Promise<string>;
};

const parserErrors: Record<string, string> = {
  invalid_file: "The file is not valid Markdown text.",
  file_too_large: "The file exceeds the Markdown size limit.",
  invalid_frontmatter: "The front matter is invalid or unsupported.",
  unsupported_table:
    "Markdown tables are not supported yet. Convert the table to text before importing.",
  unsafe_link: "The file contains an unsupported link.",
  invalid_document:
    "The document is too large, malformed, or unsupported. Split complex documents into smaller files.",
  invalid_note: "The title or tags are invalid.",
};

export async function readMarkdownFiles(
  files: readonly MarkdownFile[],
): Promise<{
  notes: ReturnType<typeof parseMarkdown>;
  errors: { name: string; message: string }[];
}> {
  const notes: ReturnType<typeof parseMarkdown> = [];
  const errors: { name: string; message: string }[] = [];
  if (files.length > MAX_MARKDOWN_FILES)
    throw new Error("Import at most 100 files at once.");
  const eligibleBytes = files.reduce(
    (total, file) =>
      /\.(?:md|markdown|mdown)$/i.test(file.name) &&
      Number.isSafeInteger(file.size) &&
      file.size >= 0 &&
      file.size <= MAX_MARKDOWN_FILE_BYTES
        ? total + file.size
        : total,
    0,
  );
  if (eligibleBytes > MAX_MARKDOWN_BATCH_BYTES)
    throw new Error("Import batches up to 10 MB.");
  let admittedBytes = 0;

  for (const file of files) {
    const reject = (message: string) =>
      errors.push({ name: file.name, message });
    if (!/\.(?:md|markdown|mdown)$/i.test(file.name)) {
      reject("Choose a Markdown file.");
      continue;
    }
    if (
      !Number.isSafeInteger(file.size) ||
      file.size < 0 ||
      file.size > MAX_MARKDOWN_FILE_BYTES
    ) {
      reject("Choose Markdown files up to 2 MB each.");
      continue;
    }
    if (admittedBytes + file.size > MAX_MARKDOWN_BATCH_BYTES) {
      reject("The batch exceeds the 10 MB Markdown limit.");
      continue;
    }
    admittedBytes += file.size;
    let content: string;
    try {
      content = await file.text();
    } catch {
      reject("The file could not be read.");
      continue;
    }
    const decodedBytes = new TextEncoder().encode(content).length;
    admittedBytes += Math.max(0, decodedBytes - file.size);
    if (
      decodedBytes > MAX_MARKDOWN_FILE_BYTES ||
      admittedBytes > MAX_MARKDOWN_BATCH_BYTES
    ) {
      reject(
        decodedBytes > MAX_MARKDOWN_FILE_BYTES
          ? "Choose Markdown files up to 2 MB each."
          : "Import batches up to 10 MB.",
      );
      continue;
    }
    try {
      notes.push(...parseMarkdown([{ name: file.name, content }]));
    } catch (error) {
      const code = error instanceof Error ? error.message.split(":", 1)[0] : "";
      reject(
        parserErrors[code ?? ""] ?? "The Markdown file could not be parsed.",
      );
    }
  }
  return { notes, errors };
}
