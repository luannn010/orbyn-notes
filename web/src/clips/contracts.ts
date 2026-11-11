import type { PersistenceState } from "../domain/contracts";
import type { CollectionsRevision } from "../collections/contracts";

export type Clip = {
  id: string;
  revision: number;
  originalUrl: string;
  canonicalUrl: string;
  title: string;
  text: string | null;
  createdAt: string;
  updatedAt: string;
  readAt: string | null;
  readLater: boolean;
  archivedAt: string | null;
};
export type ClipActionInput =
  | {
      kind: "create";
      url: string;
      title: string;
      text: string;
      readLater: boolean;
      allowDuplicate: boolean;
    }
  | { kind: "set-read"; clipId: string; targetRevision: number; read: boolean }
  | {
      kind: "set-read-later";
      clipId: string;
      targetRevision: number;
      readLater: boolean;
    }
  | {
      kind: "set-archived";
      clipId: string;
      targetRevision: number;
      archived: boolean;
    }
  | { kind: "undo-create"; receiptOperationId: string; targetRevision: number };
export type ClipReceipt = {
  operationId: string;
  digest: string;
  kind: ClipActionInput["kind"];
  clipId: string;
  resultRevision: number | null;
  at: string;
  changed: boolean;
};
export type ClipState = { items: Clip[]; receipts: ClipReceipt[] };
export type ClipSnapshot = {
  epoch: string;
  revision: number;
  clips: ClipState;
};
declare const intentBrand: unique symbol;
export type ClipIntent = Readonly<{
  operationId: string;
  clipId: string;
  [intentBrand]: true;
}>;
export type ClipMutationResult = {
  snapshot: ClipSnapshot;
  receipt: ClipReceipt;
  changed: boolean;
  replayed: boolean;
};
export interface ClipsStore {
  read(): Promise<ClipSnapshot>;
  prepare(
    expected: CollectionsRevision,
    input: ClipActionInput,
  ): Promise<ClipIntent>;
  commit(intent: ClipIntent): Promise<ClipMutationResult>;
  subscribe(listener: () => void): () => void;
  persistence(): PersistenceState;
  onInvalidate(listener: (reason: "epoch" | "closed") => void): () => void;
  close(): void;
}
export type ClipErrorCode =
  | "clip_invalid"
  | "clip_limit"
  | "clip_stale"
  | "clip_intent_revoked"
  | "clip_undo_unavailable"
  | "clip_operation_reused";
export class ClipError extends Error {
  constructor(
    public readonly code: ClipErrorCode,
    message: string,
  ) {
    super(`${code}: ${message}`);
    this.name = "ClipError";
  }
}
export class ClipDuplicateError extends Error {
  readonly code = "clip_duplicate";
  readonly existing: Pick<
    Clip,
    "id" | "title" | "originalUrl" | "createdAt" | "revision" | "archivedAt"
  >;
  constructor(clip: Clip) {
    super("This link is already saved.");
    this.name = "ClipDuplicateError";
    const { id, title, originalUrl, createdAt, revision, archivedAt } = clip;
    this.existing = { id, title, originalUrl, createdAt, revision, archivedAt };
  }
}
export class ClipConflictError extends Error {
  readonly code = "clip_conflict";
  constructor(public readonly current: ClipSnapshot) {
    super("Clips changed. Reload before applying this action again.");
    this.name = "ClipConflictError";
  }
}
export type ClipExportFile = { filename: string; content: string };
