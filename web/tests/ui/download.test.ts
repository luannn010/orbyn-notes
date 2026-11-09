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
