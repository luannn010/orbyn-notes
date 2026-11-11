import type { ClipExportFile, ClipState } from "./contracts";
import { validateClipState } from "./validation";

export function exportClipsFiles(input: ClipState): ClipExportFile[] {
  const clips = validateClipState(input);
  if (!clips.items.length) return [];
  return [
    {
      filename: "clips.json",
      content: JSON.stringify({ version: 1, ...clips }, null, 2),
    },
    {
      filename: "README.txt",
      content:
        "Clips plaintext export\n\nThis export contains private links and pasted text. Store it somewhere safe. clips.json contains all saved clip fields and operation receipts. Each item also has a readable text file. Text is user-pasted content, not fetched from the source. Recovery is manual; this version has no automatic import or restore. No account keys, passphrases or engine snapshots are included.\n",
    },
    ...clips.items.map((item) => ({
      filename: `clip-${item.id}.txt`,
      content: `${item.title}\nSource: ${item.originalUrl}\nCanonical URL: ${item.canonicalUrl}\nProvenance: ${item.text === null ? "Link only" : "Pasted text"}\nSaved: ${item.createdAt}\nUpdated: ${item.updatedAt}\nRead: ${item.readAt ?? "Unread"}\nRead later: ${item.readLater ? "Yes" : "No"}\nArchived: ${item.archivedAt ?? "No"}\nID: ${item.id}\nRevision: ${item.revision}\n\n---\n${item.text ?? "Only the link is saved."}`,
    })),
  ];
}
