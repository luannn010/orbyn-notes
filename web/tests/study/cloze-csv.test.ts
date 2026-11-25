import { describe, expect, it } from "vitest";
import type { StudyEntry, StudyState } from "../../src/collections/contracts";
import {
  buildCardContent,
  disposeCardContent,
  readCardContentPage,
} from "../../src/study/cardContent";
import type { CardContentReader } from "../../src/study/cardContent";
import { scanClozeText } from "../../src/study/cloze";
import { exportStudyCsv, importStudyCsv, parseStudyCsv } from "../../src/study/csv";
import { cardText, createDeck, saveEntry } from "../../src/study/model";
import { validateMakeCardDraft } from "../../src/study/sourceValidation";

const at = new Date("2026-11-11T12:00:00Z");
const empty = (): StudyState => ({
  decks: [],
  entries: [],
  cards: [],
  events: [],
  preferences: {
    algorithm: "orbyn-interval-v1",
    timezone: "UTC",
    dayStartHour: 4,
    newPerDay: 10,
    reviewsPerDay: 100,
    showNextReview: true,
    showStreak: true,
  },
});
function seed() {
  const state = createDeck(empty(), "Deck", at);
  return { state, deckId: state.decks[0]!.id };
}
type ClozeEntry = Extract<StudyEntry, { type: "cloze" }>;
function cloze(
  deckId: string,
  text: string,
  blanks: { id: string; answer: string }[],
): ClozeEntry {
  return {
    id: crypto.randomUUID(),
    deckId,
    revision: 1,
    tags: [],
    source: null,
    type: "cloze",
    text,
    blanks,
  };
}
function settle<T>(iterator: Iterator<unknown, T, void>): T {
  let step = iterator.next();
  while (!step.done) step = iterator.next();
  return step.value;
}
function read(reader: CardContentReader, side: "front" | "back"): string {
  let page = settle(readCardContentPage(reader, side)),
    text = page.text;
  while (page.next) {
    page = settle(readCardContentPage(reader, side, page.next));
    text += page.text;
  }
  return text;
}

describe("cloze answers with braces", () => {
  it("round-trips an answer containing braces as the exact answer", () => {
    const { state, deckId } = seed();
    const entry = cloze(deckId, "{{first}} and {{second}}", [
      { id: "first", answer: "a{b" },
      { id: "second", answer: "c}d" },
    ]);
    const saved = saveEntry(state, entry, at);
    expect(saved.cards).toHaveLength(2);
    expect(cardText(saved.entries[0]!, "cloze:first")).toEqual({
      front: "[...] and c}d",
      back: "a{b and c}d",
    });
    // The CSV export renders that answer and re-parses it unchanged.
    const exported = parseStudyCsv(exportStudyCsv(saved, deckId));
    expect(exported.map((row) => row.back)).toContain("a{b and c}d");
  });

  it("accepts the inline spelling only when it equals the stored answer", () => {
    const { state, deckId } = seed();
    const saved = saveEntry(
      state,
      cloze(deckId, "{{first::a{b}} and {{second}}", [
        { id: "first", answer: "a{b" },
        { id: "second", answer: "c}d" },
      ]),
      at,
    );
    expect(cardText(saved.entries[0]!, "cloze:first")).toEqual({
      front: "[...] and c}d",
      back: "a{b and c}d",
    });
    expect(() =>
      saveEntry(
        state,
        cloze(deckId, "{{first::a{b}}", [{ id: "first", answer: "other" }]),
        at,
      ),
    ).toThrow("cloze");
  });

  it("parses {{c1::a}b}} as one blank with answer a}b", () => {
    expect(scanClozeText("{{c1::a}b}}")).toEqual({
      markers: [{ id: "c1", answer: "a}b", from: 0, to: 11 }],
      residue: false,
    });
    const { state, deckId } = seed();
    const saved = saveEntry(
      state,
      cloze(deckId, "{{c1::a}b}}", [{ id: "c1", answer: "a}b" }]),
      at,
    );
    expect(saved.cards).toHaveLength(1);
    expect(cardText(saved.entries[0]!, "cloze:c1")).toEqual({
      front: "[...]",
      back: "a}b",
    });
  });

  it("renders the same directions as cardText at the session reader", () => {
    const entry = cloze("deck", "{{first::a{b}} and {{second}}", [
      { id: "first", answer: "a{b" },
      { id: "second", answer: "c}d" },
    ]);
    for (const id of ["first", "second"] as const) {
      const reader = settle(
        buildCardContent({
          type: "cloze",
          key: `cloze:${id}`,
          text: entry.text,
          blanks: entry.blanks,
        }),
      );
      try {
        const rendered = cardText(entry, `cloze:${id}`);
        expect(read(reader, "front")).toBe(rendered.front);
        expect(read(reader, "back")).toBe(rendered.back);
      } finally {
        disposeCardContent(reader);
      }
    }
  });

  it("applies the same rule to the card model and the source draft", () => {
    const { state, deckId } = seed();
    const draft = {
      type: "cloze" as const,
      deckId: crypto.randomUUID(),
      tags: [],
      text: "{{c1::a}b}}",
      blanks: [{ id: "c1", answer: "a}b" }],
    };
    expect(validateMakeCardDraft(draft)).toEqual(draft);
    const broken = cloze(deckId, "{{c1}} {{", [{ id: "c1", answer: "a" }]);
    expect(() => saveEntry(state, broken, at)).toThrow("cloze");
    expect(() => validateMakeCardDraft({ ...draft, text: broken.text })).toThrow();
  });
});

describe("CSV import row validation", () => {
  it("names the failing row and imports nothing", () => {
    const { state, deckId } = seed();
    const before = structuredClone(state);
    // A quote inside a bare field fails on physical line 4.
    expect(() =>
      importStudyCsv(
        state,
        deckId,
        'Front,Back\nQ1,A1\nQ2,A2\nQ"3,A3\nQ4,A4',
        at,
      ),
    ).toThrow(/Row 4/);
    expect(state).toEqual(before);
    // A quoted newline keeps the physical line numbers truthful: line 5 is
    // the row with a fourth column.
    expect(() =>
      importStudyCsv(
        state,
        deckId,
        'Front,Back\n"multi\nline",A2\nQ3,A3\nQ4,A4,extra,more',
        at,
      ),
    ).toThrow(/Row 5/);
    expect(state).toEqual(before);
    // Content errors keep naming the row where it starts.
    expect(() =>
      importStudyCsv(
        state,
        deckId,
        'Front,Back\nQ1,A1\n"multi\nline",',
        at,
      ),
    ).toThrow(/Row 3/);
    expect(state).toEqual(before);
  });

  it("still imports every row of a valid file", () => {
    const { state, deckId } = seed();
    const imported = importStudyCsv(
      state,
      deckId,
      'Front,Back,Tags\nQ1,A1,"[""t""]"\nQ2,A2,',
      at,
    );
    expect(imported.entries).toHaveLength(2);
    expect(imported.cards).toHaveLength(2);
    expect(imported.entries).toMatchObject([
      { type: "basic", front: "Q1", back: "A1", tags: ["t"] },
      { type: "basic", front: "Q2", back: "A2", tags: [] },
    ]);
    expect(state.entries).toHaveLength(0);
  });
});
