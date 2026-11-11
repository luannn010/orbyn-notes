import type { SearchLocator } from "../search/results";
export type ClipSearchOpenRequest = Readonly<{
  requestId: string;
  target: Extract<SearchLocator, { kind: "clip" }>;
}>;
export type CardSearchOpenRequest = Readonly<{
  requestId: string;
  target: Extract<SearchLocator, { kind: "card" }>;
}>;
export type SearchReaderResult = (
  requestId: string,
  status: "opened" | "blocked" | "unavailable",
) => void;
