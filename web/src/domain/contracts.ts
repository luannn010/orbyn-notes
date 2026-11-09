export type RichNode = {
  type: string;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
  content?: RichNode[];
};
export type NoteDocument = { type: "doc"; content: RichNode[] };
export type Note = {
  id: string;
  title: string;
  document: NoteDocument;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  trashedAt: string | null;
  revision: number;
};
export type PersistenceState = {
  status: "ready" | "saving" | "failed";
  message?: string;
};
export type AccountIdentity = {
  accountId: string;
  deviceId: string;
  email: string;
};
export type AccountSession = AccountIdentity & {
  deviceState: "trusted" | "pending";
};
export interface NotesStore {
  list(): Promise<Note[]>;
  get(id: string): Promise<Note | null>;
  create(input: {
    title: string;
    document: NoteDocument;
    tags: string[];
  }): Promise<Note>;
  update(
    id: string,
    patch: Partial<Pick<Note, "title" | "document" | "tags">>,
    expectedRevision: number,
  ): Promise<Note>;
  trash(id: string, expectedRevision: number): Promise<Note>;
  restore(id: string, expectedRevision: number): Promise<Note>;
  erase(): Promise<void>;
  subscribe(listener: () => void): () => void;
  persistence(): PersistenceState;
  close(): void;
}
export class RevisionConflictError extends Error {
  readonly code = "revision_conflict";
  constructor(
    public readonly current: Note,
    public readonly attempted: Note,
  ) {
    super("This note changed in another window. Keep a copy of your draft.");
    this.name = "RevisionConflictError";
  }
}
export interface AccountService {
  current(): Promise<AccountSession | null>;
  checkInvite(invite: string): Promise<void>;
  register(input: {
    invite: string;
    email: string;
    password: string;
  }): Promise<{ signupId: string }>;
  verifyEmail(input: {
    signupId: string;
    code: string;
  }): Promise<AccountSession>;
  resendEmail(signupId: string): Promise<void>;
  signIn(input: { email: string; password: string }): Promise<AccountSession>;
  completeSecondFactor(input: {
    code?: string;
    recoveryCode?: string;
  }): Promise<AccountSession>;
  pendingDevice(): Promise<{
    status: "waiting" | "compare" | "trusted";
    sas?: string;
  }>;
  confirmDevice(code?: string): Promise<AccountSession>;
  cancelDevice(): Promise<void>;
  signOut(): Promise<void>;
}
export class AccountError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AccountError";
  }
}
