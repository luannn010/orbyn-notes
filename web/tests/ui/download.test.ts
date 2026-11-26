// @vitest-environment node
import { describe, it, expect } from "vitest";
import { unzipSync, strFromU8 } from "fflate";
import { buildDownload } from "../../src/ui/download";
import type { Note } from "../../src/domain/contracts";
const note: Note = {
  id: "one",
  title: "../Synthetic note",
  tags: ["Work"],
  document: {
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: "Safe export" }] },
    ],
  },
  revision: 1,
  createdAt: "2026-01-01",
  updatedAt: "2026-01-01",
  trashedAt: null,
};
describe("download preparation", () => {
  it("uses the same filename for a Markdown file and its ZIP entry", async () => {
    const input = { ...note, title: "Title" };
    const markdown = buildDownload([input], false);
    const archive = buildDownload([input], true);
    const files = unzipSync(new Uint8Array(await archive.blob.arrayBuffer()));
    expect(Object.keys(files)).toEqual(["Title-1.md"]);
    expect(strFromU8(files[markdown.name]!)).toBe(await markdown.blob.text());
  });
  it("keeps duplicate titles distinct and separates Trash without numbering twice", async () => {
    const notes = [
      { ...note, title: "Title" },
      {
        ...note,
        id: "two",
        title: "Title",
        document: {
          type: "doc" as const,
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "Second note" }],
            },
          ],
        },
      },
      { ...note, id: "three", title: "Title", trashedAt: "2026-02-01" },
    ];
    for (const archive of [false, true]) {
      const result = buildDownload(notes, archive);
      const files = unzipSync(new Uint8Array(await result.blob.arrayBuffer()));
      expect(Object.keys(files)).toEqual([
        "Title-1.md",
        "Title-2.md",
        "Trash/Title-3.md",
      ]);
      expect(strFromU8(files["Title-1.md"]!)).toContain("Safe export");
      expect(strFromU8(files["Title-2.md"]!)).toContain("Second note");
      expect(strFromU8(files["Trash/Title-3.md"]!)).toContain("Safe export");
    }
  });
  it("exports a single Markdown file with preserved tags", async () => {
    const result = buildDownload([note], false);
    expect(result.name).not.toContain("/");
    expect(await result.blob.text()).toContain("Work");
    expect(await result.blob.text()).toContain("Safe export");
  });
  it("always builds one ZIP for export all, even one note, with Trash separated", async () => {
    const result = buildDownload([{ ...note, trashedAt: "2026-02-01" }], true);
    expect(result.name).toBe("orbyn-notes.zip");
    const files = unzipSync(new Uint8Array(await result.blob.arrayBuffer()));
    expect(Object.keys(files)).toHaveLength(1);
    expect(Object.keys(files)[0]).toMatch(/^Trash\//);
    expect(strFromU8(Object.values(files)[0]!)).toContain("Safe export");
  });
});
