import type { Note, NoteDocument, PersistenceState } from "../domain/contracts";
import type {
  CollectionsRevision,
  CollectionsState,
  StudyEntry,
} from "../collections/contracts";
import type {
  LibraryState,
  LibraryToken,
  NotesLibraryStore,
} from "../library/contracts";
import type {
  SourceEditProof,
  SourceFingerprint,
  SourcePassage,
} from "./sourceCodec";

export type AnchoredStudySource = {
  version: 2;
  noteId: string;
  noteRevision: number;
  quote: string;
  libraryEpoch: string;
  anchorId: string;
};
export type SourceAnchor = {
  id: string;
  revision: number;
  noteId: string;
  entryId: string;
  birth: {
    noteRevision: number;
    documentDigest: string;
    from: number;
    to: number;
  };
  noteRevision: number;
  from: number;
  to: number;
  quote: string;
  documentDigest: string;
  status: "attached" | "stale";
  staleReason: null | "passage-edited" | "document-replaced";
};
export type SavedNoteSelection = {
  noteId: string;
  noteRevision: number;
  libraryEpoch: string;
  fingerprint: SourceFingerprint;
  passage: SourcePassage;
};
export type MakeCardDraft = { deckId: string; tags: string[] } & (
  | { type: "basic" | "reversed"; front: string; back: string }
  | { type: "cloze"; text: string; blanks: { id: string; answer: string }[] }
);
export type SourceExpected = {
  library: LibraryToken;
  collections: CollectionsRevision;
};
export type SourceReceipt = {
  operationId: string;
  digest: string;
  kind: "create" | "undo";
  at: string;
  entryId: string;
  cardIds: string[];
  anchorId: string;
  createOperationId: string;
  entryRevision: 1;
  cardRevisions: number[];
  anchorRevision: 1;
};
declare const sourceIntentBrand: unique symbol;
export type MakeCardIntent = Readonly<{
  kind: "create";
  operationId: string;
  entryId: string;
  [sourceIntentBrand]: true;
}>;
export type UndoMakeCardIntent = Readonly<{
  kind: "undo";
  operationId: string;
  entryId: string;
  [sourceIntentBrand]: true;
}>;
export type SourceResolution =
  | {
      status: "attached";
      entryId: string;
      anchorId: string;
      anchorRevision: number;
      noteId: string;
      noteRevision: number;
      documentDigest: string;
      from: number;
      to: number;
      quote: string;
    }
  | {
      status: "unavailable";
      reason: "legacy" | "stale" | "missing" | "trashed" | "locked";
    };
export type SourceAnnotation = Extract<
  SourceResolution,
  { status: "attached" }
>;
export type MakeCardResult = {
  entryId: string;
  cardIds: string[];
  source: SourceResolution;
  receipt: SourceReceipt;
  changed: boolean;
  replayed: boolean;
  tokens: SourceExpected;
};
export interface StudySourceService {
  prepareCreate(
    selection: SavedNoteSelection,
    expected: SourceExpected,
    draft: MakeCardDraft,
  ): Promise<MakeCardIntent>;
  prepareUndo(
    expected: SourceExpected,
    receiptOperationId: string,
  ): Promise<UndoMakeCardIntent>;
  commit(intent: MakeCardIntent | UndoMakeCardIntent): Promise<MakeCardResult>;
  resolve(entryId: string): Promise<SourceResolution>;
  annotations(noteId: string): Promise<SourceAnnotation[]>;
  subscribe(listener: () => void): () => void;
  persistence(): PersistenceState;
  onInvalidate(listener: (reason: "epoch" | "closed") => void): () => void;
  close(): void;
}
export type SourceErrorCode =
  | "source_invalid"
  | "source_limit"
  | "source_stale"
  | "source_revoked"
  | "source_undo_unavailable"
  | "source_operation_reused";
export class SourceError extends Error {
  constructor(
    public readonly code: SourceErrorCode,
    message: string,
  ) {
    super(`${code}: ${message}`);
    this.name = "SourceError";
  }
}
export class SourceConflictError extends Error {
  readonly code = "source_conflict";
  constructor(public readonly current: SourceExpected) {
    super(
      "The source or Study collection changed. Reload before trying again.",
    );
    this.name = "SourceConflictError";
  }
}
/** Private owner bridge: all calls use the existing library snapshot writer. */
export type SourceOwnerSnapshot = {
  notes: Note[];
  library: LibraryState;
  collections: CollectionsState;
};
export interface SourceOwnerAccess {
  read(): Promise<SourceOwnerSnapshot>;
  commit(
    command: SourceCommand,
    guard: () => void,
  ): Promise<{ snapshot: SourceOwnerSnapshot; replayed: boolean }>;
}
export type SourceAwareNoteUpdate = (
  noteId: string,
  patch: Partial<Pick<Note, "title" | "document" | "tags">>,
  expectedRevision: number,
  proof: SourceEditProof,
) => Promise<Note>;
export type SourceCommand = {
  operationId: string;
  digest: string;
  expected: SourceExpected;
  preparedAt: string;
  entryId: string;
} & (
  | {
      kind: "create";
      selection: SavedNoteSelection;
      draft: MakeCardDraft;
      anchorId: string;
      cardIds: string[];
    }
  | { kind: "undo"; original: SourceReceipt }
);
