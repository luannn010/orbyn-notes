import { zipSync, strToU8 } from "fflate";
import type { Note } from "../domain/contracts";
import { exportMarkdown } from "../transfer";
export function buildDownload(
  notes: Note[],
  archive: boolean,
): { blob: Blob; name: string } {
  const output = exportMarkdown(notes);
  if (!archive && notes.length === 1) {
    const file = output[0]!;
    return {
      blob: new Blob([file.content], { type: "text/markdown;charset=utf-8" }),
      name: file.filename,
    };
  }
  const files: Record<string, Uint8Array> = {};
  output.forEach((file, index) => {
    files[
      `${notes[index]?.trashedAt ? "Trash/" : ""}${index + 1}-${file.filename}`
    ] = strToU8(file.content);
  });
  return {
    blob: new Blob([zipSync(files) as BlobPart], { type: "application/zip" }),
    name: "orbyn-notes.zip",
  };
}
