import { zipSync, strToU8 } from "fflate";
import type { NoteExportFile } from "../links/contracts";
export function noteLinkDownload(
  files: readonly NoteExportFile[],
  archive: boolean,
) {
  if (!archive && files.length === 1) {
    const file = files[0]!;
    return {
      blob: new Blob([file.content], { type: "text/markdown;charset=utf-8" }),
      name: file.filename,
    };
  }
  const entries: Record<string, Uint8Array> = {};
  for (const file of files) entries[file.filename] = strToU8(file.content);
  return {
    blob: new Blob([zipSync(entries) as BlobPart], { type: "application/zip" }),
    name: "orbyn-notes.zip",
  };
}
