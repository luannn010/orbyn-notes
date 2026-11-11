import type { NoteLinksRow } from "../links/contracts";
import type { Note, NoteDocument, NotesStore } from "../domain/contracts";
import type {
  SourceAnchor,
  SourceReceipt,
  SourceAwareNoteUpdate,
} from "../study/sourceContracts";
export type LibraryToken = { epoch: string; revision: number };
export type NoteSort = "edited" | "created" | "title";
export type TagColor = string | null;
export type Tag = {
  id: string;
  name: string;
  color: TagColor;
  revision: number;
  createdAt: string;
  updatedAt: string;
  state: "active" | "deleted" | "merged";
  mergedInto: string | null;
};
export type NoteMetadata = {
  noteId: string;
  revision: number;
  pinned: boolean;
  tagIds: string[];
};
export type NoteVersion = {
  id: string;
  noteId: string;
  noteRevision: number;
  capturedAt: string;
  reason: "edit" | "history-restore";
  title: string;
  document: NoteDocument;
  tagsAtCapture: { id: string; name: string; color: TagColor }[];
};
export type TrashUndo = {
  epoch: string;
  operationId: string;
  noteId: string;
  resultRevision: number;
  previousTrashedAt: string | null;
  resultTrashedAt: string | null;
  expiresAt: string;
};
export type LibraryAction =
  | "pin"
  | "sort"
  | "tag-create"
  | "tag-rename"
  | "tag-color"
  | "tag-merge"
  | "tag-delete"
  | "history-restore"
  | "trash"
  | "restore"
  | "trash-undo"
  | "empty-trash"
  | "legacy-erase"
  | "note-links-repair";
export type LibraryOperationReceipt = {
  id: string;
  epoch: string;
  committedAt: string;
  libraryRevision: number;
  kind: LibraryAction;
  arguments: string;
  result:
    | { type: "metadata" }
    | { type: "tag"; tagId: string }
    | {
        type: "note";
        noteId: string;
        resultRevision: number;
        undo: TrashUndo | null;
      }
    | { type: "empty-trash"; removedCount: number }
    | { type: "note-links-repair"; indexDigest: string };
};
export type LegacyLibraryState = {
  version: 1;
  epoch: string;
  revision: number;
  tags: Tag[];
  noteMetadata: NoteMetadata[];
  versions: NoteVersion[];
  preferences: { sort: NoteSort };
  receipts: LibraryOperationReceipt[];
  legacyDuplicateTags: { noteId: string; values: string[] }[];
};
export type SourceLibraryState = Omit<LegacyLibraryState, "version"> & {
  version: 2;
  anchors: SourceAnchor[];
  sourceReceipts: SourceReceipt[];
};
export type LinkedLibraryState = Omit<SourceLibraryState, "version"> & {
  version: 3;
  noteLinks: NoteLinksRow[];
};
export type LibraryState = SourceLibraryState | LinkedLibraryState;
export type LibraryCommonState = Omit<SourceLibraryState, "version"> & {
  version: 2 | 3;
};
export type LibrarySnapshot = {
  token: LibraryToken;
  notes: Note[];
  tags: Tag[];
  metadata: NoteMetadata[];
  preferences: { sort: NoteSort };
};
export type LibraryReadResult =
  | { mode: "ready"; snapshot: LibrarySnapshot }
  | {
      mode: "legacy-read-only";
      notes: Note[];
      reason: "metadata-limit";
      recovery: { kind: "export-or-confirm-erase"; deviceGeneration: number };
    };
export type LibraryMutationResult = {
  snapshot: LibrarySnapshot;
  note: Note | null;
  tag: Tag | null;
  undo: TrashUndo | null;
  removedCount: number;
  replayed: boolean;
};
export interface NotesLibrary {
  replaceDocument(
    noteId: string,
    input: Pick<Note, "title" | "document" | "tags">,
    expectedRevision: number,
  ): Promise<Note>;
  updateWithSourceSteps: SourceAwareNoteUpdate;
  read(): Promise<LibraryReadResult>;
  setPinned(
    noteId: string,
    pinned: boolean,
    expected: LibraryToken,
    operationId: string,
  ): Promise<LibraryMutationResult>;
  setSort(
    sort: NoteSort,
    expected: LibraryToken,
    operationId: string,
  ): Promise<LibraryMutationResult>;
  createTag(
    input: { name: string; color: TagColor },
    expected: LibraryToken,
    operationId: string,
  ): Promise<LibraryMutationResult>;
  renameTag(
    id: string,
    name: string,
    expected: LibraryToken,
    operationId: string,
  ): Promise<LibraryMutationResult>;
  recolorTag(
    id: string,
    color: TagColor,
    expected: LibraryToken,
    operationId: string,
  ): Promise<LibraryMutationResult>;
  mergeTag(
    sourceId: string,
    targetId: string,
    expected: LibraryToken,
    operationId: string,
  ): Promise<LibraryMutationResult>;
  deleteTag(
    id: string,
    expected: LibraryToken,
    operationId: string,
  ): Promise<LibraryMutationResult>;
  history(noteId: string): Promise<NoteVersion[]>;
  version(noteId: string, versionId: string): Promise<NoteVersion | null>;
  restoreVersion(
    noteId: string,
    versionId: string,
    expectedNoteRevision: number,
    operationId: string,
  ): Promise<LibraryMutationResult>;
  changeTrash(
    noteId: string,
    action: "trash" | "restore",
    expectedNoteRevision: number,
    operationId: string,
  ): Promise<LibraryMutationResult>;
  undoTrash(
    receipt: TrashUndo,
    operationId: string,
  ): Promise<LibraryMutationResult>;
  emptyTrash(
    expected: LibraryToken,
    operationId: string,
  ): Promise<LibraryMutationResult>;
  eraseLegacy(
    input: { deviceGeneration: number; confirmation: "ERASE" },
    operationId: string,
  ): Promise<LibraryMutationResult>;
}
export interface NotesLibraryStore extends NotesStore {
  library: NotesLibrary;
}
export class LibraryReadOnlyError extends Error {
  readonly code = "library_read_only";
  constructor() {
    super(
      "library_read_only: Library metadata exceeds its limit. Export your notes or confirm erasing this workspace.",
    );
    this.name = "LibraryReadOnlyError";
  }
}
export class LibraryConflictError extends Error {
  readonly code = "library_conflict";
  constructor(public readonly current: LibrarySnapshot) {
    super("library_conflict: The library changed. Reload before trying again.");
    this.name = "LibraryConflictError";
  }
}
export class LibraryEpochError extends Error {
  readonly code = "library_epoch_changed";
  constructor() {
    super(
      "library_epoch_changed: This workspace was erased. Reopen it before making changes.",
    );
    this.name = "LibraryEpochError";
  }
}
export class LibraryCapacityError extends Error {
  readonly code = "library_capacity";
  constructor() {
    super(
      "library_capacity: Library metadata or history exceeds its supported size.",
    );
    this.name = "LibraryCapacityError";
  }
}
