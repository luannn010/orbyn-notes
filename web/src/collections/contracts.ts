import type { PersistenceState } from "../domain/contracts";
import type { ClipState } from "../clips/contracts";
import type { AnchoredStudySource } from "../study/sourceContracts";

export type Grade = "again" | "hard" | "good" | "easy";
export type Schedule = {
  version: 1;
  state: "new" | "learning" | "review";
  due: string;
  intervalDays: number;
  ease: number;
  repetitions: number;
  lapses: number;
  lastReviewedAt: string | null;
};
export type Deck = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  revision: number;
};
export type LegacyStudySource = {
  noteId: string;
  noteRevision: number;
  quote: string;
};
export type StudySource = LegacyStudySource | AnchoredStudySource;
type EntryBase = {
  id: string;
  deckId: string;
  tags: string[];
  source: StudySource | null;
  revision: number;
};
export type StudyEntry = EntryBase &
  (
    | { type: "basic"; front: string; back: string }
    | { type: "reversed"; front: string; back: string }
    | { type: "cloze"; text: string; blanks: { id: string; answer: string }[] }
  );
export type CardKey =
  "basic:forward" | "reversed:forward" | "reversed:reverse" | `cloze:${string}`;
export type ReviewCard = {
  id: string;
  entryId: string;
  key: CardKey;
  schedule: Schedule;
  revision: number;
};
export type ReviewSnapshot = { schedule: Schedule; cardRevision: number };
export type ReviewEvent = {
  id: string;
  cardId: string;
  sessionId: string;
  at: string;
  grade: Grade;
  algorithm: "orbyn-interval-v1";
  before: ReviewSnapshot;
  after: ReviewSnapshot;
  undoneAt: string | null;
};
export type StudyPreferences = {
  algorithm: "orbyn-interval-v1";
  timezone: string;
  dayStartHour: number;
  newPerDay: number;
  reviewsPerDay: number;
  showNextReview: boolean;
  showStreak: boolean;
};
export type StudyState = {
  decks: Deck[];
  entries: StudyEntry[];
  cards: ReviewCard[];
  events: ReviewEvent[];
  preferences: StudyPreferences;
};
/** Binary fields use canonical padded base64. Only JournalVault replaces this envelope. */
export type JournalEnvelope = {
  version: 1;
  kdf: { name: "PBKDF2-SHA256"; iterations: 600000; salt: string };
  iv: string;
  ciphertext: string;
};
export type LegacyCollectionsState = {
  version: 1;
  epoch: string;
  revision: number;
  study: StudyState;
  journal: JournalEnvelope | null;
};
export type CollectionsStateV2 = Omit<LegacyCollectionsState, "version"> & {
  version: 2;
  clips: ClipState;
};
export type CollectionsState = Omit<CollectionsStateV2, "version"> & {
  version: 3;
};
export type CollectionsRevision = Pick<CollectionsState, "epoch" | "revision">;
export interface CollectionsStore {
  read(): Promise<CollectionsState>;
  update(
    expected: CollectionsRevision,
    change: (current: CollectionsState) => CollectionsState,
  ): Promise<CollectionsState>;
  subscribe(listener: () => void): () => void;
  persistence(): PersistenceState;
  close(): void;
}
export class CollectionsRevisionConflictError extends Error {
  readonly code = "collections_revision_conflict";
  constructor(public readonly current: CollectionsState) {
    super("Collections changed in another window. Reload before retrying.");
    this.name = "CollectionsRevisionConflictError";
  }
}
