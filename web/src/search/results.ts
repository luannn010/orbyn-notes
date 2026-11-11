import type { CardKey } from "../collections/contracts";
import type { SearchInvalidation, SearchVersions } from "./contracts";
import type { SearchExcerpt } from "./matching";

export type SearchKind = "note" | "clip" | "card";
/** Numeric presentation intent only; it grants no source/cursor identity. */
export type SearchPageIntent = Readonly<Partial<Record<SearchKind, number>>>;
export type SearchCounts = Readonly<{
  notes: number;
  clips: number;
  cards: number;
  all: number;
}>;
export type SearchLocator =
  | Readonly<{
      kind: "note";
      accountId: string;
      libraryEpoch: string;
      noteId: string;
    }>
  | Readonly<{
      kind: "clip";
      accountId: string;
      collectionsEpoch: string;
      clipId: string;
    }>
  | Readonly<{
      kind: "card";
      accountId: string;
      collectionsEpoch: string;
      cardId: string;
      entryId: string;
      key: CardKey;
    }>;
export type SearchHit = Readonly<{
  locator: SearchLocator;
  entityRevision: number;
  primary: SearchExcerpt;
  secondary: readonly SearchExcerpt[];
  // Source metadata only. These labels are never fabricated searchable fields.
  archived?: boolean;
  clipContent?: "saved-text" | "link-only";
  deckTitle?: string;
}>;
export type SearchProgress = Readonly<{
  phase: "indexing" | "matching" | "ordering" | "projecting";
  checkedEntities: number;
  totalEntities: number;
}>;
declare const handleBrand: unique symbol;
declare const cursorBrand: unique symbol;
export type SearchHandle = Readonly<{ [handleBrand]: true }>;
export type SearchCursor = Readonly<{ [cursorBrand]: true }>;
export type SearchGroup = Readonly<{
  kind: SearchKind;
  items: readonly SearchHit[];
  offset: number;
  previous: SearchCursor | null;
  next: SearchCursor | null;
}>;
export type SearchPageState =
  | Readonly<{ status: "pending"; kind: SearchKind }>
  | Readonly<{ status: "paused"; kind: SearchKind; handle: SearchHandle }>
  | Readonly<{ status: "error"; kind: SearchKind; handle: SearchHandle }>;
export type SearchState =
  | Readonly<{ status: "idle"; raw: "" }>
  | Readonly<{
      status: "pending";
      raw: string;
      progress: SearchProgress | null;
    }>
  | Readonly<{
      status: "paused-limit";
      raw: string;
      handle: SearchHandle;
      progress: SearchProgress | null;
    }>
  | Readonly<{ status: "changed"; raw: string }>
  | Readonly<{
      status: "error";
      raw: string;
      code:
        | "query-too-long"
        | "query-invalid"
        | "query-too-many-terms"
        | "source-unavailable";
    }>
  | Readonly<{
      status: "ready";
      raw: string;
      handle: SearchHandle;
      versions: SearchVersions;
      counts: SearchCounts;
      groups: readonly SearchGroup[];
      page: SearchPageState | null;
    }>;
export interface LocalSearchService {
  getSnapshot(): SearchState;
  subscribe(listener: () => void): () => void;
  onInvalidate(listener: (reason: SearchInvalidation) => void): () => void;
  query(
    raw: string,
    signal?: AbortSignal,
    initialPages?: SearchPageIntent,
  ): Promise<void>;
  continue(handle: SearchHandle, signal?: AbortSignal): Promise<void>;
  page(cursor: SearchCursor, signal?: AbortSignal): Promise<void>;
  cancelPage(): void;
  cancel(): void;
  close(): void;
}
