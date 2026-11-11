import { foldCodePoint } from "./unicodeCaseFolding";

export type SearchQueryErrorCode =
  | "query-too-long"
  | "query-invalid"
  | "query-too-many-terms";

export class SearchQueryError extends Error {
  constructor(public readonly code: SearchQueryErrorCode) {
    super(
      code === "query-too-long"
        ? "Use at most 200 characters for a search."
        : code === "query-too-many-terms"
          ? "Use at most 12 different words for a search."
          : "Finish entering the current character before searching.",
    );
    this.name = "SearchQueryError";
  }
}

export type SearchQuery = Readonly<{
  raw: string;
  terms: readonly string[];
}>;

/** Query input is bounded before any transform. Stored text is not validated
 * here: legacy lone UTF16 units remain literal source text. */
export function compileSearchQuery(raw: string): SearchQuery | null {
  if (raw.length > 200) throw new SearchQueryError("query-too-long");
  let folded = "";
  for (let offset = 0; offset < raw.length; ) {
    const point = raw.codePointAt(offset)!;
    if (point >= 0xd800 && point <= 0xdfff)
      throw new SearchQueryError("query-invalid");
    folded += foldCodePoint(point);
    offset += point > 0xffff ? 2 : 1;
  }
  const terms = [...new Set(folded.split(/\s+/u).filter(Boolean))];
  if (terms.length > 12) throw new SearchQueryError("query-too-many-terms");
  return terms.length === 0
    ? null
    : Object.freeze({ raw, terms: Object.freeze(terms) });
}
