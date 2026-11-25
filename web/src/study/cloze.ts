/**
 * One cloze grammar, shared by the card model, card rendering, source drafts,
 * stored-state validation and the card editor:
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
 * prose: unmatched "{{" or "}}" must not make an otherwise valid card fail.
 */
export type ClozeBlank = { id: string; answer: string };
export type ClozeMarker = {
  id: string;
  answer: string | null;
  from: number;
  to: number;
};
export type ClozeProblem = "unmatched" | "duplicate" | "answer";

const ID = /^[A-Za-z0-9_-]{1,100}$/;

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

/** Scan cloze text once, left to right, and report its well-formed markers. */
export function scanClozeText(text: string): ClozeMarker[] {
  const markers: ClozeMarker[] = [];
  // Once no "}}" exists at or after a position, no later inline answer can close.
  let closeFrom = Number.POSITIVE_INFINITY;
  for (let at = 0; at + 1 < text.length; ) {
    if (text[at] !== "{" || text[at + 1] !== "{") {
      at++;
      continue;
    }
    let end = at + 2;
    while (end < text.length && end - at - 2 < 100 && idUnit(text[end]!))
      end++;
    const id = text.slice(at + 2, end);
    if (text.startsWith("}}", end) && ID.test(id)) {
      markers.push({ id, answer: null, from: at, to: end + 2 });
      at = end + 2;
      continue;
    }
    if (text.startsWith("::", end) && ID.test(id) && end + 2 < closeFrom) {
      const close = text.indexOf("}}", end + 2);
      if (close >= 0) {
        markers.push({
          id,
          answer: text.slice(end + 2, close),
          from: at,
          to: close + 2,
        });
        at = close + 2;
        continue;
      }
      closeFrom = end + 2;
    }
    at++;
  }
  return markers;
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
