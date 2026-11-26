import type { WorkEvent } from "../search/work";

/**
 * One cloze grammar, shared by the card model, source drafts, stored-state
 * validation and the card editor; the streaming card reader implements the same
 * marker grammar.
 *
 *   marker := "{{" id ( "::" answer )? "}}"
 *   id     := [A-Za-z0-9_-]{1,100}
 *   answer := any text without the two-character sequence "}}"
 *
 * The answer body is literal, so a single "{" or "}" is allowed and the marker
 * closes at the first "}}": `{{c1::a}b}}` is one blank, id `c1`, answer `a}b`.
 * The editor stores answers in `blanks` and writes the placeholder form
 * `{{id}}`; the inline form `{{id::answer}}` is the same blank and its answer
 * must equal the stored one, so the two spellings can never disagree.
 *
 * Only well-formed markers are read. Braces elsewhere in the text stay literal
 * prose for validation: unmatched "{{" or "}}" must not make an otherwise valid
 * card fail.
 */
export type ClozeBlank = { id: string; answer: string };
export type ClozeMarker = {
  id: string;
  answer: string | null;
  from: number;
  to: number;
};
export type ClozeProblem = "unmatched" | "duplicate" | "answer";

function idUnit(unit: string): boolean {
  const code = unit.charCodeAt(0);
  return (
    (code >= 48 && code <= 57) ||
    (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122) ||
    code === 95 ||
    code === 45
  );
}

/** Offsets keep long inline answers in their original source until admitted. */
export type ClozeSpan = {
  id: string;
  from: number;
  to: number;
  answerFrom: number | null;
  answerTo: number;
};

/** Call in source order on one text. Each caller reserves its chunk before scan. */
export class ClozeScanner {
  private stage = 0;
  private open = -1;
  private length = 0;
  private idEnd = -1;
  private answerFrom: number | null = null;

  scan(text: string, from: number, to: number): ClozeSpan[] {
    const found: ClozeSpan[] = [];
    for (let at = from; at < to; at++) {
      const unit = text[at]!;
      if (this.stage === 0) {
        if (unit === "{") { this.open = at; this.stage = 1; }
      } else if (this.stage === 1) {
        if (unit === "{") {
          this.stage = 2;
          this.length = 0;
          this.answerFrom = null;
        } else this.stage = 0;
      } else if (this.stage === 2) {
        if (idUnit(unit) && this.length < 100) this.length++;
        else if (unit === "}" && this.length) {
          this.idEnd = at;
          this.stage = 3;
        } else if (unit === ":" && this.length) {
          this.idEnd = at;
          this.stage = 4;
        } else if (unit === "{") {
          // Three opening braces include a marker beginning at the second one.
          this.open = this.length === 0 ? at - 1 : at;
          this.stage = this.length === 0 ? 2 : 1;
          this.length = 0;
        } else this.stage = 0;
      } else if (this.stage === 3) {
        if (unit === "}") {
          found.push({ id: text.slice(this.open + 2, this.idEnd), from: this.open,
            to: at + 1, answerFrom: null, answerTo: at - 1 });
          this.stage = 0;
        } else if (unit === "{") { this.open = at; this.stage = 1; }
        else this.stage = 0;
      } else if (this.stage === 4) {
        if (unit === ":") { this.answerFrom = at + 1; this.stage = 5; }
        else if (unit === "{") { this.open = at; this.stage = 1; }
        else this.stage = 0;
      } else if (this.stage === 5) {
        if (unit === "}") this.stage = 6;
      } else if (unit === "}") {
        found.push({ id: text.slice(this.open + 2, this.idEnd), from: this.open,
          to: at + 1, answerFrom: this.answerFrom, answerTo: at - 1 });
        this.stage = 0;
      } else this.stage = 5;
    }
    return found;
  }
}

/** Compare inline answers without joining or copying an unbounded source span. */
export function* clozeAnswerMatches(
  text: string,
  marker: ClozeSpan,
  answer: string,
): Generator<WorkEvent, boolean, void> {
  if (marker.answerFrom === null) return true;
  if (marker.answerTo - marker.answerFrom !== answer.length) return false;
  for (let from = 0; from < answer.length;) {
    const to = Math.min(answer.length, from + 4096);
    const cost = { bytes: (to - from) * 6 + 64, visits: 1, scalars: to - from };
    yield { type: "reserve", ...cost };
    let equal = true;
    for (let at = from; at < to; at++) {
      if (text.charCodeAt(marker.answerFrom + at) !== answer.charCodeAt(at)) {
        equal = false;
        break;
      }
    }
    yield { type: "settle", ...cost };
    if (!equal) return false;
    from = to;
  }
  return true;
}

/** Synchronous validators use the same grammar as the bounded readers. */
export function scanClozeText(text: string): ClozeMarker[] {
  return new ClozeScanner().scan(text, 0, text.length).map((marker) => ({
    id: marker.id, from: marker.from, to: marker.to,
    answer: marker.answerFrom === null ? null : text.slice(marker.answerFrom, marker.answerTo),
  }));
}

/**
 * Report the first way `text` and `blanks` disagree under the grammar above.
 * Callers validate blank ids, duplicates and answer text on their own terms and
 * only need to map the returned problem to their own error surface.
 */
export function clozeProblem(
  text: string,
  blanks: readonly ClozeBlank[],
): ClozeProblem | null {
  const markers = scanClozeText(text);
  const answers = new Map<string, string>();
  for (const blank of blanks) if (!answers.has(blank.id)) answers.set(blank.id, blank.answer);
  const seen = new Set<string>();
  for (const marker of markers) {
    const answer = answers.get(marker.id);
    if (answer === undefined) return "unmatched";
    if (seen.has(marker.id)) return "duplicate";
    seen.add(marker.id);
    if (marker.answer !== null && marker.answer !== answer) return "answer";
  }
  for (const blank of blanks) if (!seen.has(blank.id)) return "unmatched";
  return null;
}
