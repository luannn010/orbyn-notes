// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { readMarkdownFiles } from "../../src/transfer/readFiles";
import {
  MAX_MARKDOWN_BATCH_BYTES,
  MAX_MARKDOWN_FILE_BYTES,
} from "../../src/transfer";

function file(name: string, content = "body", size = content.length) {
  return { name, size, text: vi.fn(async () => content) };
}

describe("readMarkdownFiles", () => {
  it("retains valid files around named parser and read failures without exposing contents", async () => {
    const first = file("first.md", "First");
    const binary = file("binary.md", "secret\0content");
    const readFailure = {
      name: "unreadable.md",
      size: 5,
      text: vi.fn(async () => {
        throw new Error("secret data");
      }),
    };
    const malformed = file("table.md", "| A | B |\n|---|---|\n| 1 | 2 |");
    const last = file("last.markdown", "Last");
    const files = [first, binary, readFailure, malformed, last];
    const result = await readMarkdownFiles(files);
    expect(result.notes.map((note) => note.title)).toEqual(["first", "last"]);
    expect(result.errors.map((error) => error.name)).toEqual([
      "binary.md",
      "unreadable.md",
      "table.md",
    ]);
    expect(JSON.stringify(result.errors)).not.toContain("secret");
    expect(result.errors[2]!.message).toContain("tables");
    expect(files).toEqual([first, binary, readFailure, malformed, last]);
  });

  it("does not read invalid extensions or oversized files but retains valid ones", async () => {
    const invalid = file("bad.txt");
    const big = file("big.md", "", MAX_MARKDOWN_FILE_BYTES + 1);
    const good = file("good.MDOWN");
    const result = await readMarkdownFiles([invalid, big, good]);
    expect(invalid.text).not.toHaveBeenCalled();
    expect(big.text).not.toHaveBeenCalled();
    expect(result.errors.map((error) => error.name)).toEqual([
      "bad.txt",
      "big.md",
    ]);
    expect(result.notes.map((note) => note.title)).toEqual(["good"]);
  });

  it("rejects too many files and oversized eligible batches before reading", async () => {
    const tooMany = Array.from({ length: 101 }, (_, i) => file(`${i}.md`));
    await expect(readMarkdownFiles(tooMany)).rejects.toThrow(
      "Import at most 100 files at once.",
    );
    expect(tooMany.every((item) => item.text.mock.calls.length === 0)).toBe(
      true,
    );
    const tooLarge = Array.from({ length: 6 }, (_, i) =>
      file(`${i}.md`, "", MAX_MARKDOWN_FILE_BYTES),
    );
    await expect(readMarkdownFiles(tooLarge)).rejects.toThrow(
      "Import batches up to 10 MB.",
    );
    expect(tooLarge.every((item) => item.text.mock.calls.length === 0)).toBe(
      true,
    );
  });

  it("charges failed reads and permits a later file that fits the remaining budget", async () => {
    const failed = {
      name: "failed.md",
      size: MAX_MARKDOWN_FILE_BYTES,
      text: vi.fn(async () => {
        throw new Error("failed");
      }),
    };
    const inflated = file("inflated.md", "😀".repeat(400_000), 1);
    const rest = Array.from({ length: 4 }, (_, i) =>
      file(`${i}.md`, "x", MAX_MARKDOWN_FILE_BYTES - (i === 3 ? 2 : 0)),
    );
    const small = file("small.md", "ok", 1);
    const result = await readMarkdownFiles([failed, inflated, ...rest, small]);
    expect(rest[3]!.text).not.toHaveBeenCalled();
    expect(small.text).toHaveBeenCalledOnce();
    expect(result.errors.map((error) => error.name)).toContain("3.md");
    expect(result.notes.map((note) => note.title)).toContain("small");
  });

  it("enforces decoded UTF-8 file size and structural limits", async () => {
    const oversized = file("decoded.md", "😀".repeat(500_001), 1);
    const deep = file("deep.md", `${"> ".repeat(40)}text`);
    const result = await readMarkdownFiles([oversized, deep]);
    expect(result.notes).toEqual([]);
    expect(result.errors.map((error) => error.name)).toEqual([
      "decoded.md",
      "deep.md",
    ]);
    expect(MAX_MARKDOWN_BATCH_BYTES).toBe(10_000_000);
  });
});
