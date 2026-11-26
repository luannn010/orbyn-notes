import { expect, it } from "vitest";
import { parseStudyCsv, importStudyCsv, exportStudyCsv } from "../../src/study/csv";
import { createDeck } from "../../src/study/model";
import { emptyStudy } from "../../src/collections/validation";
it("imports quoted multiline Unicode cards and exports without schedules", () => {
  const state = createDeck(emptyStudy(), "Languages", new Date());
  const source = 'Front,Back,Tags\r\n"Question, one","Answer ""two""\n日本語","[""tag with space""]"\r\n';
  const rows = parseStudyCsv(source);
  expect(rows).toEqual([{ front: "Question, one", back: 'Answer "two"\n日本語', tags: ["tag with space"] }]);
  const imported = importStudyCsv(state, state.decks[0]!.id, source, new Date());
  expect(imported.cards).toHaveLength(1);
  const exported = exportStudyCsv(imported, state.decks[0]!.id);
  expect(parseStudyCsv(exported)).toEqual(rows);
  expect(exported).not.toContain("schedule");
  expect(state.cards).toHaveLength(0);
});
it.each(['Front,Back\n"unclosed,answer', 'Wrong,Back\nx,y', 'Front,Back\nQ,A\nMissing,', 'Front,Back,Tags\nQ,A,not-json', 'Front,Back\n"Q"bad,A'])('rejects invalid CSV without mutating input state: %s', source => {
  const state = createDeck(emptyStudy(), "Deck", new Date());
  const before = structuredClone(state);
  expect(() => importStudyCsv(state, state.decks[0]!.id, source, new Date())).toThrow();
  expect(state).toEqual(before);
});

it.each([
  ["CR", "\r"],
  ["LF", "\n"],
  ["CRLF", "\r\n"],
])("counts %s inside quoted fields as one physical line", (_name, newline) => {
  const header = `Front,Back${newline}`;
  const valid = `"q${newline}continued",a${newline}`;
  expect(parseStudyCsv(header + valid)).toEqual([
    { front: `q${newline}continued`, back: "a", tags: [] },
  ]);
  expect(() => parseStudyCsv(header + valid + "bad"))
    .toThrow("Row 4 has 1 columns");
  expect(() => parseStudyCsv(header + valid + '"unclosed'))
    .toThrow("Row 4 has a quoted field that is not closed");
});
