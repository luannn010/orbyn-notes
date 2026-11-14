import type { CardKey } from "../collections/contracts";
import type { NoteTarget } from "../links/contracts";

declare const leaseBrand: unique symbol;
declare const nodeBrand: unique symbol;
declare const entryBrand: unique symbol;
export type SearchLease = Readonly<{ [leaseBrand]: true }>;
export type SearchNodeCursor = Readonly<{ [nodeBrand]: true }>;
export type SearchEntryCursor = Readonly<{ [entryBrand]: true }>;
export type SearchInvalidation = "changed" | "epoch" | "closed" | "unverified";
export type SearchVersions = Readonly<{
  accountId: string;
  library: Readonly<{ epoch: string; revision: number }>;
  collections: Readonly<{ epoch: string; revision: number }>;
}>;
export type SearchNoteView = Readonly<{
  id: string;
  revision: number;
  title: string;
  tags: readonly string[];
  updatedAt: string;
  root: SearchNodeCursor;
}>;
export type SearchNodeView = Readonly<{
  type: string;
  text: string | null;
  target: NoteTarget | null;
  children: number;
}>;
export type SearchClipView = Readonly<{
  id: string;
  revision: number;
  title: string;
  originalUrl: string;
  canonicalUrl: string;
  text: string | null;
  updatedAt: string;
  archivedAt: string | null;
}>;
export type SearchDeckView = Readonly<{
  id: string;
  revision: number;
  title: string;
}>;
export type SearchEntryView = Readonly<{
  id: string;
  revision: number;
  deckId: string;
  tags: readonly string[];
}> &
  (
    | Readonly<{ type: "basic" | "reversed"; front: string; back: string }>
    | Readonly<{
        type: "cloze";
        text: string;
        blankCount: number;
        cursor: SearchEntryCursor;
      }>
  );
export type SearchCardView = Readonly<{
  id: string;
  revision: number;
  entryId: string;
  key: CardKey;
}>;
export type SearchSourceReader = Readonly<{
  versions: SearchVersions;
  counts: Readonly<{
    notes: number;
    clips: number;
    decks: number;
    entries: number;
    cards: number;
  }>;
  note(index: number): SearchNoteView;
  node(cursor: SearchNodeCursor): SearchNodeView;
  child(cursor: SearchNodeCursor, index: number): SearchNodeCursor;
  clip(index: number): SearchClipView;
  deck(index: number): SearchDeckView;
  entry(index: number): SearchEntryView;
  blank(
    cursor: SearchEntryCursor,
    index: number,
  ): Readonly<{ id: string; answer: string }>;
  card(index: number): SearchCardView;
}>;
export type SearchSourceErrorCode =
  | "search_source_invalid"
  | "search_source_unavailable"
  | "search_source_corrupt"
  | "search_source_changed"
  | "search_source_revoked";
export class SearchSourceError extends Error {
  constructor(public readonly code: SearchSourceErrorCode) {
    super("The local search source is unavailable or changed.");
    this.name = "SearchSourceError";
  }
}
