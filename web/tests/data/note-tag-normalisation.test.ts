import { describe, expect, it } from "vitest";
import {
  validateInput,
  validateNoteInput,
  validateNotes,
} from "../../src/domain/validation";

describe("Note tag identity on write", () => {
  const plainDocument = () => ({
    type: "doc" as const,
    content: [{ type: "paragraph", content: [{ type: "text", text: "Body" }] }],
  });
  const draft = (tags: string[]) => ({
    title: "A note",
    document: plainDocument(),
    tags,
  });
  const legacyNote = (tags: string[]) => ({
    id: "legacy-note",
    ...draft(tags),
    revision: 1,
    createdAt: "2026-11-11T00:00:00.000Z",
    updatedAt: "2026-11-11T00:00:00.000Z",
    trashedAt: null,
  });

  it("trims and case-deduplicates tags when a note is created or updated", () => {
    const written = draft(["a", "A", " a"]);
    expect(validateInput(written).tags).toEqual(["a"]);
    expect(written.tags).toEqual(["a", "A", " a"]);
    expect(validateInput(draft([" A ", "a", "b", "B"])).tags).toEqual([
      "A",
      "b",
    ]);
    expect(validateNoteInput(draft(["a", "A", " a"])).tags).toEqual(["a"]);
  });

  it("keeps the first typed form, its order and its distinct letters", () => {
    expect(validateInput(draft(["Apple", "apple", "banana"])).tags).toEqual([
      "Apple",
      "banana",
    ]);
    // ß and SS read differently on screen, so they stay separate tags.
    expect(validateInput(draft(["straße", "STRASSE"])).tags).toEqual([
      "straße",
      "STRASSE",
    ]);
  });

  it("drops tags that are empty once trimmed", () => {
    expect(validateInput(draft(["a", "   ", "", "\tnotes "])).tags).toEqual([
      "a",
      "notes",
    ]);
  });

  it("is idempotent, so a rewrite changes nothing further", () => {
    const once = validateInput(draft(["a", "A", " a", " A "])).tags;
    expect(validateInput(draft(once)).tags).toEqual(once);
  });

  it("keeps legacy stored tags on load instead of collapsing them", () => {
    expect(validateNotes([legacyNote(["a", "A", " a"])])[0]?.tags).toEqual([
      "a",
      "A",
      " a",
    ]);
  });
});
