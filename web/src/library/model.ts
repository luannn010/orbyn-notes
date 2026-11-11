import type { Note, RichNode } from "../domain/contracts";
import type {
  LibrarySnapshot,
  LibraryState,
  LibraryCommonState,
  NoteVersion,
  Tag,
  TagColor,
} from "./contracts";
import { LibraryCapacityError } from "./contracts";
import { LIBRARY_LIMITS, jsonBytes } from "./validation";

export function emptyLibrary(revision = 0): LibraryState {
  return {
    version: 2,
    epoch: crypto.randomUUID(),
    revision,
    tags: [],
    noteMetadata: [],
    versions: [],
    preferences: { sort: "edited" },
    receipts: [],
    legacyDuplicateTags: [],
    anchors: [],
    sourceReceipts: [],
  };
}
export function internTag(
  state: LibraryState,
  name: string,
  now: string,
  color: TagColor = null,
): Tag {
  const existing = state.tags.find(
    (tag) => tag.state === "active" && tag.name === name,
  );
  if (existing) return existing;
  if (state.tags.length >= LIBRARY_LIMITS.tags)
    throw new LibraryCapacityError();
  const tag: Tag = {
    id: crypto.randomUUID(),
    name,
    color,
    revision: 1,
    createdAt: now,
    updatedAt: now,
    state: "active",
    mergedInto: null,
  };
  state.tags.push(tag);
  return tag;
}
export function syncMembership(
  state: LibraryState,
  note: Note,
  now: string,
): void {
  const tagIds = note.tags.map((name) => internTag(state, name, now).id);
  const existing = state.noteMetadata.find((meta) => meta.noteId === note.id);
  if (existing) {
    if (JSON.stringify(existing.tagIds) !== JSON.stringify(tagIds)) {
      existing.tagIds = tagIds;
      existing.revision++;
    }
  } else
    state.noteMetadata.push({
      noteId: note.id,
      revision: 1,
      pinned: false,
      tagIds,
    });
}
export function adoptLibrary(
  notes: Note[],
  original: unknown[],
  now: string,
): LibraryState {
  const state = emptyLibrary();
  for (const note of notes) syncMembership(state, note, now);
  for (const raw of original) {
    const note = raw as Note;
    if (new Set(note.tags).size !== note.tags.length)
      state.legacyDuplicateTags.push({
        noteId: note.id,
        values: [...note.tags],
      });
  }
  return state;
}
export function snapshot(
  state: LibraryCommonState,
  notes: Note[],
): LibrarySnapshot {
  return structuredClone({
    token: { epoch: state.epoch, revision: state.revision },
    notes,
    tags: state.tags,
    metadata: state.noteMetadata,
    preferences: state.preferences,
  });
}
export function sameDocument(a: unknown, b: unknown): boolean {
  const canonical = (value: unknown) =>
    JSON.stringify(value, (_key, entry: unknown) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry))
        return entry;
      return Object.fromEntries(
        Object.entries(entry).sort(([a], [b]) => a.localeCompare(b)),
      );
    });
  return canonical(a) === canonical(b);
}
export function captureVersion(
  state: LibraryState,
  note: Note,
  reason: NoteVersion["reason"],
  now: string,
): string {
  const existing = state.versions.find(
    (version) =>
      version.noteId === note.id && version.noteRevision === note.revision,
  );
  if (existing) return existing.id;
  const meta = state.noteMetadata.find((meta) => meta.noteId === note.id)!;
  const version: NoteVersion = {
    id: crypto.randomUUID(),
    noteId: note.id,
    noteRevision: note.revision,
    capturedAt: now,
    reason,
    title: note.title,
    document: structuredClone(note.document),
    tagsAtCapture: meta.tagIds.map((id) => {
      const tag = state.tags.find((tag) => tag.id === id)!;
      return { id: tag.id, name: tag.name, color: tag.color };
    }),
  };
  state.versions.push(version);
  return version.id;
}
export function retainHistory(
  state: LibraryState,
  now: number,
  protectedId?: string,
): void {
  const sorted = state.versions
    .filter(
      (version) =>
        version.id === protectedId ||
        Date.parse(version.capturedAt) >= now - LIBRARY_LIMITS.historyAgeMs,
    )
    .sort(
      (a, b) =>
        a.capturedAt.localeCompare(b.capturedAt) || a.id.localeCompare(b.id),
    );
  const perNote = new Map<string, { count: number; bytes: number }>();
  const sizes = new Map(
    sorted.map((version) => [version.id, jsonBytes(version)]),
  );
  for (const version of sorted) {
    const group = perNote.get(version.noteId) ?? { count: 0, bytes: 0 };
    group.count++;
    group.bytes += sizes.get(version.id)!;
    perNote.set(version.noteId, group);
  }
  const removed = new Set<string>();
  for (const version of sorted) {
    const group = perNote.get(version.noteId)!;
    if (
      (group.count > LIBRARY_LIMITS.noteVersions ||
        group.bytes > LIBRARY_LIMITS.noteHistoryBytes) &&
      version.id !== protectedId
    ) {
      removed.add(version.id);
      group.count--;
      group.bytes -= sizes.get(version.id)!;
    }
  }
  let bytes =
    2 +
    sorted
      .filter((version) => !removed.has(version.id))
      .reduce((sum, version) => sum + sizes.get(version.id)! + 1, 0);
  for (const version of sorted) {
    if (bytes <= LIBRARY_LIMITS.historyBytes) break;
    if (!removed.has(version.id) && version.id !== protectedId) {
      removed.add(version.id);
      bytes -= sizes.get(version.id)! + 1;
    }
  }
  if (
    bytes > LIBRARY_LIMITS.historyBytes ||
    [...perNote.values()].some(
      (group) =>
        group.count > LIBRARY_LIMITS.noteVersions ||
        group.bytes > LIBRARY_LIMITS.noteHistoryBytes,
    )
  )
    throw new LibraryCapacityError();
  state.versions = sorted.filter((version) => !removed.has(version.id));
}
export function removeNotes(state: LibraryState, ids: Set<string>): void {
  state.anchors = state.anchors.filter((anchor) => !ids.has(anchor.noteId));
  state.noteMetadata = state.noteMetadata.filter(
    (meta) => !ids.has(meta.noteId),
  );
  state.versions = state.versions.filter((version) => !ids.has(version.noteId));
  state.legacyDuplicateTags = state.legacyDuplicateTags.filter(
    (item) => !ids.has(item.noteId),
  );
  if (state.version === 3)
    state.noteLinks = state.noteLinks.filter((row) => !ids.has(row.noteId));
  for (const receipt of state.receipts)
    if (receipt.result.type === "note" && ids.has(receipt.result.noteId))
      receipt.result.undo = null;
}
export function retainReceipts(
  state: LibraryState,
  now: number,
  protectedId?: string,
): void {
  state.receipts = state.receipts
    .filter(
      (receipt) =>
        receipt.kind === "note-links-repair" ||
        Date.parse(receipt.committedAt) >= now - LIBRARY_LIMITS.receiptAgeMs,
    )
    .sort(
      (a, b) =>
        a.committedAt.localeCompare(b.committedAt) || a.id.localeCompare(b.id),
    );
  while (state.receipts.length > LIBRARY_LIMITS.receipts) {
    state.receipts.splice(
      state.receipts.findIndex((receipt) => receipt.id !== protectedId),
      1,
    );
  }
}
export function activeTag(state: LibraryState, id: string): Tag {
  const tag = state.tags.find((tag) => tag.id === id && tag.state === "active");
  if (!tag) throw new Error("tag_missing: This tag is unavailable.");
  return tag;
}
function reviseMemberships(
  state: LibraryState,
  notes: Note[],
  sourceId: string,
  targetId: string | null,
  now: string,
): void {
  for (const meta of state.noteMetadata) {
    if (!meta.tagIds.includes(sourceId)) continue;
    meta.tagIds = [
      ...new Set(
        meta.tagIds.flatMap((id) =>
          id === sourceId ? (targetId ? [targetId] : []) : [id],
        ),
      ),
    ];
    meta.revision++;
    const note = notes.find((note) => note.id === meta.noteId)!;
    note.tags = meta.tagIds.map((id) => activeTag(state, id).name);
    note.revision++;
    note.updatedAt = now;
  }
}
export function renameTag(
  state: LibraryState,
  notes: Note[],
  id: string,
  name: string,
  now: string,
): void {
  const tag = activeTag(state, id);
  if (
    state.tags.some(
      (other) =>
        other.id !== id && other.state === "active" && other.name === name,
    )
  )
    throw new Error(
      "tag_name_conflict: That tag exists. Merge the tags explicitly instead.",
    );
  tag.name = name;
  tag.revision++;
  tag.updatedAt = now;
  reviseMemberships(state, notes, id, id, now);
}
export function mergeTags(
  state: LibraryState,
  notes: Note[],
  sourceId: string,
  targetId: string,
  now: string,
): void {
  if (sourceId === targetId)
    throw new Error("tag_merge_invalid: Choose a different target tag.");
  const source = activeTag(state, sourceId),
    target = activeTag(state, targetId);
  for (const tag of state.tags)
    if (tag.state === "merged" && tag.mergedInto === sourceId) {
      tag.mergedInto = targetId;
      tag.revision++;
      tag.updatedAt = now;
    }
  source.state = "merged";
  source.mergedInto = targetId;
  source.revision++;
  source.updatedAt = now;
  target.revision++;
  target.updatedAt = now;
  reviseMemberships(state, notes, sourceId, targetId, now);
}
export function deleteTag(
  state: LibraryState,
  notes: Note[],
  id: string,
  now: string,
): void {
  activeTag(state, id);
  for (const tag of state.tags)
    if (tag.id === id || (tag.state === "merged" && tag.mergedInto === id)) {
      tag.state = "deleted";
      tag.mergedInto = null;
      tag.revision++;
      tag.updatedAt = now;
    }
  reviseMemberships(state, notes, id, null, now);
}
function plain(node: RichNode): string {
  return [node.text ?? "", ...(node.content ?? []).map(plain)].join(" ");
}
export function projectLibraryNotes(
  state: LibrarySnapshot,
  options: {
    query?: string;
    tagId?: string;
    trash?: boolean;
    pinnedOnly?: boolean;
  } = {},
): Note[] {
  const metadata = new Map(state.metadata.map((meta) => [meta.noteId, meta])),
    query = options.query?.trim().toLocaleLowerCase() ?? "";
  return state.notes
    .filter(
      (note) =>
        Boolean(note.trashedAt) === Boolean(options.trash) &&
        (!options.pinnedOnly || metadata.get(note.id)?.pinned) &&
        (!options.tagId ||
          metadata.get(note.id)?.tagIds.includes(options.tagId)) &&
        (!query ||
          `${note.title} ${plain(note.document)} ${note.tags.join(" ")}`
            .toLocaleLowerCase()
            .includes(query)),
    )
    .sort(
      (a, b) =>
        (!options.trash
          ? Number(metadata.get(b.id)?.pinned) -
            Number(metadata.get(a.id)?.pinned)
          : 0) ||
        (state.preferences.sort === "title"
          ? a.title.localeCompare(b.title, "en", { sensitivity: "base" })
          : Date.parse(
              state.preferences.sort === "created" ? b.createdAt : b.updatedAt,
            ) -
            Date.parse(
              state.preferences.sort === "created" ? a.createdAt : a.updatedAt,
            )) ||
        a.title.localeCompare(b.title) ||
        a.id.localeCompare(b.id),
    );
}
