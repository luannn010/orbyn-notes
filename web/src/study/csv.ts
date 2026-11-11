import type { StudyEntry, StudyState } from "../collections/contracts";
import { cardText } from "./model";
import { initialSchedule } from "./scheduler";

const MAX_BYTES = 10_000_000;
/** RFC-style quoted CSV. Parse and validate the whole input before creating cards. */
export function parseStudyCsv(source: string): { front: string; back: string; tags: string[] }[] {
  if (new TextEncoder().encode(source).length > MAX_BYTES || source.includes("\0")) throw new Error("invalid_csv: Choose a text CSV file up to 10 MB.");
  source = source.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [], field = "", quoted = false, closed = false;
  const finishField = () => { row.push(field); field = ""; closed = false; };
  const finishRow = () => {
    finishField();
    if (row.some(value => value.trim())) rows.push(row);
    row = [];
    if (rows.length > 10001) throw new Error("csv_limit: Import at most 10,000 rows.");
  };
  for (let i = 0; i < source.length; i++) {
    const char = source[i]!;
    if (quoted) {
      if (char === '"') {
        if (source[i + 1] === '"') { field += '"'; i++; }
        else { quoted = false; closed = true; }
      } else field += char;
    } else if (char === '"' && !field && !closed) quoted = true;
    else if (char === ",") finishField();
    else if (char === "\n" || char === "\r") {
      if (char === "\r" && source[i + 1] === "\n") i++;
      finishRow();
    } else {
      if (closed || char === '"') throw new Error("invalid_csv: Check the quoted fields in this file.");
      field += char;
    }
    if (field.length > 200_000 || row.length > 3) throw new Error("invalid_csv: Expected Front, Back and optional Tags columns.");
  }
  if (quoted) throw new Error("invalid_csv: A quoted field was not closed.");
  if (field || row.length || closed) finishRow();
  const header = rows.shift()?.map(value => value.trim().toLowerCase());
  if (!header || header[0] !== "front" || header[1] !== "back" || (header.length !== 2 && !(header.length === 3 && header[2] === "tags")))
    throw new Error("invalid_csv: Start with Front,Back or Front,Back,Tags headers.");
  if (!rows.length) throw new Error("empty_csv: This file has no cards to import.");
  return rows.map((values, index) => {
    if (values.length !== header.length || !values[0]?.trim() || !values[1]?.trim() || values[0].length > 100_000 || values[1].length > 100_000)
      throw new Error(`invalid_csv: Row ${index + 2} needs a question and an answer, each up to 100,000 characters.`);
    let tags: unknown = [];
    if (values[2]?.trim()) {
      try { tags = JSON.parse(values[2]); } catch { throw new Error(`invalid_csv: Row ${index + 2} Tags must be a JSON list, such as ["biology"].`); }
    }
    if (!Array.isArray(tags) || tags.length > 100 || tags.some(tag => typeof tag !== "string" || !tag.trim() || tag.length > 100))
      throw new Error(`invalid_csv: Check the tags on row ${index + 2}.`);
    return { front: values[0], back: values[1], tags: [...new Set(tags as string[])] };
  });
}

export function importStudyCsv(state: StudyState, deckId: string, source: string, at: Date): StudyState {
  const rows = parseStudyCsv(source);
  if (state.entries.length + rows.length > 10_000 || state.cards.length + rows.length > 20_000) throw new Error("card_limit: This import would exceed the card limit.");
  // Only return a new state after all rows have succeeded. No external writes here.
  if (!state.decks.some(deck => deck.id === deckId)) throw new Error("deck_missing: Choose an existing deck.");
  const next = structuredClone(state);
  for (const row of rows) {
    const entry: StudyEntry = { ...row, id: crypto.randomUUID(), deckId, revision: 1, source: null, type: "basic" };
    next.entries.push(entry);
    next.cards.push({ id: crypto.randomUUID(), entryId: entry.id, key: "basic:forward", revision: 1, schedule: initialSchedule(at) });
  }
  return next;
}

export function exportStudyCsv(state: StudyState, deckId: string): string {
  if (!state.decks.some(deck => deck.id === deckId)) throw new Error("deck_missing: This deck no longer exists.");
  const cell = (value: string) => `"${value.replaceAll('"', '""')}"`;
  const rows = ["Front,Back,Tags"];
  const entries = new Map(state.entries.filter(entry => entry.deckId === deckId).map(entry => [entry.id, entry]));
  for (const card of state.cards) {
    const entry = entries.get(card.entryId);
    if (!entry) continue;
    const rendered = cardText(entry, card.key);
    rows.push([rendered.front, rendered.back, JSON.stringify(entry.tags)].map(cell).join(","));
  }
  return `${rows.join("\r\n")}\r\n`;
}
