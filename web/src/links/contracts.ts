export type NoteTarget = Readonly<{
  kind: "note";
  accountId: string;
  libraryEpoch: string;
  noteId: string;
}>;
export type NoteLinkNode = {
  type: "noteLink";
  attrs: { version: 1; target: NoteTarget };
};
export type NoteLinksRow = {
  noteId: string;
  noteRevision: number;
  targets: { target: NoteTarget; occurrences: number }[];
};
export type LinkToken = { epoch: string; revision: number };
export type LinkProgress = {
  verifiedNotes: number;
  totalNotes: number;
  verifiedHistory: number;
  totalHistory: number;
  utf8Units: number;
  nodeVisits: number;
};
export type LinkNotReady =
  | { status: "pending"; progress: LinkProgress }
  | { status: "paused-limit"; progress: LinkProgress }
  | {
      status: "invalid";
      code: "index-mismatch" | "index-invalid" | "legacy-premise";
    };
export type LinkQuery<T> =
  { status: "ready"; token: LinkToken; items: T[] } | LinkNotReady;
export type NoteLinkResolution =
  | {
      status: "available";
      token: LinkToken;
      target: NoteTarget;
      noteRevision: number;
      title: string;
    }
  | {
      status: "unavailable";
      reason: "missing" | "trashed" | "locked" | "scope";
    };
export type Backlink = {
  sourceId: string;
  sourceRevision: number;
  title: string;
  occurrences: number;
  snippet: string;
};
export type OutgoingLink = {
  target: NoteTarget;
  occurrences: number;
  resolution: NoteLinkResolution;
};
export type LinkCandidate = {
  target: NoteTarget;
  title: string;
  noteRevision: number;
  updatedAt: string;
  thisNote: boolean;
};
declare const cursorBrand: unique symbol;
declare const repairBrand: unique symbol;
declare const exportBrand: unique symbol;
export type LinkSearchCursor = Readonly<{ [cursorBrand]: true }>;
export type LinkRepairIntent = Readonly<{
  operationId: string;
  [repairBrand]: true;
}>;
export type LinkRepairResult = Readonly<{
  operationId: string;
  committedToken: LinkToken;
  indexDigest: string;
  replayed: boolean;
}>;
export type NoteExportIntent = Readonly<{ [exportBrand]: true }>;
export type NoteExportFile = { filename: string; content: string };
export type NoteExportResult = Readonly<{
  token: LinkToken;
  files: readonly NoteExportFile[];
  warnings: readonly string[];
}>;
export type OwnerAdmission =
  | {
      mode: "legacy";
      rawVersion: 1 | 2;
      token: LinkToken;
      premise: "pending" | "paused-limit" | "verified";
    }
  | {
      mode: "current";
      token: LinkToken;
      graph: "pending" | "paused-limit" | "ready";
    }
  | {
      mode: "index-recovery";
      token: LinkToken;
      reason: "index-invalid" | "index-mismatch";
    };
export interface NoteLinkService {
  admission(): Promise<OwnerAdmission>;
  currentToken(): Promise<LinkToken>;
  search(
    query: string,
    sourceId?: string,
    cursor?: LinkSearchCursor,
  ): Promise<{
    token: LinkToken;
    items: LinkCandidate[];
    next: LinkSearchCursor | null;
  }>;
  reference(noteId: string): Promise<{ token: LinkToken; target: NoteTarget }>;
  resolve(target: NoteTarget): Promise<NoteLinkResolution>;
  outgoing(noteId: string): Promise<LinkQuery<OutgoingLink>>;
  backlinks(noteId: string): Promise<LinkQuery<Backlink>>;
  linkedNoteIds(): Promise<LinkQuery<string>>;
  verifyGraph(): Promise<{ status: "ready"; token: LinkToken } | LinkNotReady>;
  cancelVerification(): void;
  prepareRepair(expected: LinkToken): Promise<LinkRepairIntent>;
  commitRepair(intent: LinkRepairIntent): Promise<LinkRepairResult>;
  prepareExport(noteIds: readonly string[]): Promise<NoteExportIntent>;
  exportFiles(intent: NoteExportIntent): Promise<NoteExportResult>;
  assertFreshExport(result: NoteExportResult): Promise<void>;
  subscribe(listener: () => void): () => void;
  onInvalidate(listener: (reason: "epoch" | "closed") => void): () => void;
  close(): void;
}
export type NoteLinkErrorCode =
  | "note_link_invalid"
  | "note_link_limit"
  | "note_link_revoked"
  | "note_link_unavailable"
  | "note_link_migration_pending"
  | "note_link_index_invalid"
  | "note_link_verification_limit"
  | "note_link_reference_too_large"
  | "note_link_reference_unencodable";
export class NoteLinkError extends Error {
  constructor(
    public readonly code: NoteLinkErrorCode,
    message = "The note link could not be used.",
  ) {
    super(message);
    this.name = "NoteLinkError";
  }
}
export class NoteLinkConflictError extends Error {
  readonly code = "note_link_conflict";
  constructor(public readonly current: LinkToken) {
    super("The notes changed. Refresh before trying again.");
    this.name = "NoteLinkConflictError";
  }
}
