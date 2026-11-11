import { describe, expect, it } from "vitest";
import type { StudyEntry, StudyState } from "../../src/collections/contracts";
import { createDeck, saveEntry, gradeCard, undoReview, cardText, reviewQueue, progress } from "../../src/study/model";
const at = new Date("2026-11-11T12:00:00Z");
const empty = (): StudyState => ({ decks: [], entries: [], cards: [], events: [], preferences: { algorithm: "orbyn-interval-v1", timezone: "UTC", dayStartHour: 4, newPerDay: 10, reviewsPerDay: 100, showNextReview: true, showStreak: true } });
function seed() {
  const state = createDeck(empty(), "Real deck", at);
  const entry: StudyEntry = { id: crypto.randomUUID(), deckId: state.decks[0]!.id, revision: 1, tags: [], source: null, type: "reversed", front: "Question", back: "Answer" };
  return { state: saveEntry(state, entry, at), entry };
}
describe("real Study state transitions", () => {
  it("creates independently scheduled reverse cards and reconciles edits by namespaced identity", () => {
    const { state, entry } = seed();
    expect(state.cards).toHaveLength(2);
    expect(cardText(entry, "reversed:reverse")).toEqual({ front: "Answer", back: "Question" });
    const reviewed = gradeCard(state, state.cards[0]!.id, "good", crypto.randomUUID(), crypto.randomUUID(), at);
    expect(reviewed.cards[1]!.schedule.state).toBe("new");
    const edited = saveEntry(reviewed, { ...entry, revision: 2, front: "Changed" }, at);
    expect(edited.cards[0]!.id).toBe(state.cards[0]!.id);
    expect(edited.cards[0]!.schedule).toEqual(reviewed.cards[0]!.schedule);
    const changedType = saveEntry(edited, { ...entry, revision: 3, type: "cloze", text: "{{forward}}", blanks: [{ id: "forward", answer: "Cloze answer" }] }, at);
    expect(changedType.cards).toHaveLength(1);
    expect(changedType.cards[0]!.id).not.toBe(state.cards[0]!.id);
    expect(changedType.cards[0]!.schedule.state).toBe("new");
  });
  it("deduplicates retry by operation ID and safely undoes only latest unchanged grade", () => {
    const { state } = seed();
    const card = state.cards[0]!;
    const session = crypto.randomUUID(), op = crypto.randomUUID();
    const next = gradeCard(state, card.id, "easy", session, op, at);
    expect(gradeCard(next, card.id, "easy", session, op, at)).toEqual(next);
    expect(() => gradeCard(next, card.id, "again", session, op, at)).toThrow("operation");
    const undone = undoReview(next, op, at);
    expect(undone.cards[0]!.schedule).toEqual(card.schedule);
    expect(undone.events[0]!.undoneAt).toBe(at.toISOString());
    const twice = gradeCard(next, card.id, "good", session, crypto.randomUUID(), new Date(+at + 1000));
    expect(() => undoReview(twice, op, at)).toThrow("undo");
  });
  it("renders each cloze with context and rejects missing or duplicate placeholders", () => {
    const { state, entry } = seed();
    const cloze: StudyEntry = { id: crypto.randomUUID(), deckId: entry.deckId, revision: 1, tags: [], source: null, type: "cloze", text: "{{city}} is in {{country}}", blanks: [{ id: "city", answer: "Paris" }, { id: "country", answer: "France" }] };
    expect(cardText(cloze, "cloze:city")).toEqual({ front: "[...] is in France", back: "Paris is in France" });
    expect(saveEntry(state, cloze, at).cards).toHaveLength(4);
    expect(() => saveEntry(state, { ...cloze, text: "{{city}} {{city}}" }, at)).toThrow("cloze");
  });
  it("uses committed events for progress and enforces real due/new caps", () => {
    const { state } = seed();
    state.preferences.newPerDay = 1;
    expect(reviewQueue(state, at)).toHaveLength(1);
    expect(progress(state, at).remembered).toBeNull();
    const next = gradeCard(state, state.cards[0]!.id, "good", crypto.randomUUID(), crypto.randomUUID(), at);
    expect(reviewQueue(next, at)).toHaveLength(0);
    expect(progress(next, at)).toMatchObject({ reviewedThisWeek: 1, reviewedLast30Days: 1, remembered: 1, streak: 1, cardCount: 2 });
    expect(progress(undoReview(next, next.events[0]!.id, at), at).remembered).toBeNull();
  });
});
