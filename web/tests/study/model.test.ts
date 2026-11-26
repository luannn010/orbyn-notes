import { describe, expect, it } from "vitest";
import type { CollectionsState, StudyEntry, StudyState } from "../../src/collections/contracts";
import { emptyStudy } from "../../src/collections/validation";
import { emptyClips } from "../../src/clips/validation";
import { emptyLibrary } from "../../src/library/model";
import { createDeck, saveEntry, gradeCard, undoReview, cardText, reviewQueue, progress } from "../../src/study/model";
import { deleteSourceEntry, pruneOrphanAnchors } from "../../src/study/sourceModel";
import { SOURCE_LIMITS } from "../../src/study/sourceValidation";
import type { AnchoredStudySource, SourceAnchor, SourceOwnerSnapshot } from "../../src/study/sourceContracts";
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

function sourceSnapshot() {
  const noteId = crypto.randomUUID(),
    libraryEpoch = crypto.randomUUID(),
    source: AnchoredStudySource = {
      version: 2,
      noteId,
      noteRevision: 1,
      quote: "alpha beta",
      libraryEpoch,
      anchorId: crypto.randomUUID(),
    },
    deck = createDeck(emptyStudy(), "Source deck", at),
    deckId = deck.decks[0]!.id,
    card: StudyEntry = { id: crypto.randomUUID(), deckId, revision: 1, tags: [], source, type: "basic", front: "Which passage?", back: "alpha beta" },
    hand: StudyEntry = { id: crypto.randomUUID(), deckId, revision: 1, tags: [], source: null, type: "basic", front: "Manual", back: "Answer" },
    study = saveEntry(saveEntry(deck, card, at), hand, at),
    library = emptyLibrary();
  const anchor = (entryId: string, quote = "alpha beta"): SourceAnchor => ({
    id: crypto.randomUUID(),
    revision: 1,
    noteId,
    entryId,
    birth: { noteRevision: 1, documentDigest: "a".repeat(64), from: 8, to: 18 },
    noteRevision: 1,
    from: 8,
    to: 18,
    quote,
    documentDigest: "a".repeat(64),
    status: "attached",
    staleReason: null,
  });
  const cardAnchor = anchor(card.id),
    handAnchor = anchor(hand.id, "gamma delta");
  library.anchors = [cardAnchor, handAnchor];
  const collections: CollectionsState = { version: 3, epoch: crypto.randomUUID(), revision: 4, study, journal: null, clips: emptyClips() };
  const snapshot: SourceOwnerSnapshot = { notes: [], library, collections };
  return { snapshot, card, hand, cardAnchor, handAnchor };
}

describe("deleting a card that was made from a note", () => {
  it("drops its source anchor and leaves other attached anchors untouched", () => {
    const { snapshot, card, hand, handAnchor } = sourceSnapshot();
    const liveAnchor = structuredClone(handAnchor);
    deleteSourceEntry(snapshot, card.id);
    expect(snapshot.collections.study.entries.map((entry) => entry.id)).toEqual([hand.id]);
    expect(snapshot.collections.study.cards.every((reviewCard) => reviewCard.entryId === hand.id)).toBe(true);
    expect(snapshot.library.anchors).toEqual([liveAnchor]);
    expect(snapshot.library.anchors[0]).toMatchObject({ status: "attached", staleReason: null, revision: handAnchor.revision });
  });
  it("frees the SOURCE_LIMITS.anchors slot the card occupied", () => {
    const { snapshot, card } = sourceSnapshot();
    while (snapshot.library.anchors.length < SOURCE_LIMITS.anchors)
      snapshot.library.anchors.push({ ...snapshot.library.anchors[0]!, id: crypto.randomUUID(), entryId: crypto.randomUUID() });
    expect(snapshot.library.anchors).toHaveLength(SOURCE_LIMITS.anchors);
    deleteSourceEntry(snapshot, card.id);
    expect(snapshot.library.anchors).toHaveLength(SOURCE_LIMITS.anchors - 1);
  });
  it("prunes anchors left behind without an owning Study entry", () => {
    const { snapshot, handAnchor } = sourceSnapshot();
    snapshot.library.anchors.push({ ...snapshot.library.anchors[0]!, id: crypto.randomUUID(), entryId: crypto.randomUUID() });
    pruneOrphanAnchors(snapshot);
    expect(snapshot.library.anchors.map((anchor) => anchor.entryId)).toEqual(snapshot.collections.study.entries.map((entry) => entry.id));
    expect(snapshot.library.anchors).toContainEqual(handAnchor);
  });
});
