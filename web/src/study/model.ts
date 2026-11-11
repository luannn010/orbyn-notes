import type { CardKey, Grade, ReviewCard, StudyEntry, StudyState } from "../collections/contracts";
import { initialSchedule, nextSchedule, studyDay } from "./scheduler";

function text(value: string, label: string, limit = 100_000) {
  if (typeof value !== "string" || !value.trim() || value.length > limit)
    throw new Error(`invalid_${label}: Enter ${label.replaceAll("_", " ")} within ${limit} characters.`);
}
export function createDeck(state: StudyState, title: string, at: Date): StudyState {
  text(title, "deck_name", 500);
  if (state.decks.length >= 1000) throw new Error("deck_limit: You can create up to 1,000 decks.");
  const next = structuredClone(state);
  next.decks.push({ id: crypto.randomUUID(), title: title.trim(), createdAt: at.toISOString(), updatedAt: at.toISOString(), revision: 1 });
  return next;
}

function keys(entry: StudyEntry): CardKey[] {
  switch (entry.type) {
    case "basic": case "reversed":
      text(entry.front, "question"); text(entry.back, "answer");
      return entry.type === "basic" ? ["basic:forward"] : ["reversed:forward", "reversed:reverse"];
    case "cloze": {
      text(entry.text, "cloze_text");
      if (!entry.blanks.length || entry.blanks.length > 100) throw new Error("invalid_cloze: Add between 1 and 100 blanks.");
      const ids = new Set<string>();
      for (const blank of entry.blanks) {
        if (!/^[A-Za-z0-9_-]{1,100}$/.test(blank.id) || ids.has(blank.id)) throw new Error("invalid_cloze: Each blank needs a unique identifier.");
        ids.add(blank.id); text(blank.answer, "cloze_answer");
        if (entry.text.split(`{{${blank.id}}}`).length !== 2) throw new Error("invalid_cloze: Include each blank exactly once in the text.");
      }
      if ([...entry.text.matchAll(/\{\{([^{}]+)\}\}/g)].some(match => !ids.has(match[1]!)))
        throw new Error("invalid_cloze: Give every placeholder an answer.");
      return entry.blanks.map(blank => `cloze:${blank.id}` as const);
    }
    default: throw new Error("invalid_card_type: Choose Basic, Reversed or Fill in the blank.");
  }
}

export function saveEntry(state: StudyState, entry: StudyEntry, at: Date): StudyState {
  if (!state.decks.some(deck => deck.id === entry.deckId)) throw new Error("deck_missing: Choose an existing deck.");
  const nextKeys = keys(entry);
  const current = state.entries.find(item => item.id === entry.id);
  if (entry.revision !== (current?.revision ?? 0) + 1) throw new Error("entry_conflict: Reload this card before saving.");
  if (!current && state.entries.length >= 10_000) throw new Error("entry_limit: You can store up to 10,000 card entries.");
  const next = structuredClone(state);
  next.entries = next.entries.filter(item => item.id !== entry.id);
  next.entries.push(structuredClone(entry));
  const existing = state.cards.filter(card => card.entryId === entry.id);
  next.cards = next.cards.filter(card => card.entryId !== entry.id);
  for (const key of nextKeys) {
    const card = existing.find(card => card.key === key);
    next.cards.push(card ? { ...structuredClone(card), revision: card.revision + 1 } : { id: crypto.randomUUID(), entryId: entry.id, key, revision: 1, schedule: initialSchedule(at) });
  }
  if (next.cards.length > 20_000) throw new Error("card_limit: You can store up to 20,000 review cards.");
  return next;
}

export function deleteEntry(state: StudyState, entryId: string): StudyState {
  const next = structuredClone(state);
  next.entries = next.entries.filter(entry => entry.id !== entryId);
  next.cards = next.cards.filter(card => card.entryId !== entryId);
  return next;
}

export function cardText(entry: StudyEntry, key: CardKey): { front: string; back: string } {
  if (entry.type === "cloze") {
    if (!key.startsWith("cloze:") || !entry.blanks.some(blank => `cloze:${blank.id}` === key)) throw new Error("card_missing: This blank no longer exists.");
    const render = (question: boolean) => entry.text.replace(/\{\{([^{}]+)\}\}/g, (_, id: string) => question && key === `cloze:${id}` ? "[...]" : entry.blanks.find(blank => blank.id === id)?.answer ?? "[unavailable]");
    return { front: render(true), back: render(false) };
  }
  if (!keys(entry).includes(key)) throw new Error("card_missing: This card direction no longer exists.");
  return key === "reversed:reverse" ? { front: entry.back, back: entry.front } : { front: entry.front, back: entry.back };
}

export function gradeCard(state: StudyState, cardId: string, grade: Grade, sessionId: string, operationId: string, at: Date): StudyState {
  const previous = state.events.find(event => event.id === operationId);
  if (previous) {
    if (previous.cardId !== cardId || previous.grade !== grade || previous.sessionId !== sessionId || previous.at !== at.toISOString() || previous.undoneAt)
      throw new Error("operation_conflict: This review operation was already used.");
    return structuredClone(state);
  }
  const card = state.cards.find(card => card.id === cardId);
  if (!card) throw new Error("card_missing: This card no longer exists.");
  if (state.events.length >= 100_000) throw new Error("review_limit: Review history is full. Export your data before continuing.");
  const schedule = nextSchedule(card.schedule, grade, at);
  const next = structuredClone(state);
  const result = next.cards.find(item => item.id === cardId)!;
  result.schedule = schedule;
  result.revision++;
  next.events.push({ id: operationId, cardId, sessionId, at: at.toISOString(), grade, algorithm: "orbyn-interval-v1", before: { schedule: structuredClone(card.schedule), cardRevision: card.revision }, after: { schedule: structuredClone(schedule), cardRevision: result.revision }, undoneAt: null });
  return next;
}

export function undoReview(state: StudyState, eventId: string, at: Date): StudyState {
  const event = state.events.find(event => event.id === eventId);
  const card = state.cards.find(card => card.id === event?.cardId);
  if (!event || event.undoneAt || !card || card.revision !== event.after.cardRevision ||
    JSON.stringify(card.schedule) !== JSON.stringify(event.after.schedule) ||
    state.events.filter(item => item.cardId === card.id && !item.undoneAt).at(-1)?.id !== event.id)
    throw new Error("undo_unavailable: This card changed after that review. Its latest schedule was kept.");
  const next = structuredClone(state);
  const target = next.cards.find(item => item.id === card.id)!;
  target.schedule = structuredClone(event.before.schedule);
  target.revision++;
  next.events.find(item => item.id === eventId)!.undoneAt = at.toISOString();
  return next;
}

export function reviewQueue(state: StudyState, at: Date, deckId?: string): ReviewCard[] {
  const prefs = state.preferences;
  const day = studyDay(at, prefs.timezone, prefs.dayStartHour);
  const today = state.events.filter(event => !event.undoneAt && studyDay(new Date(event.at), prefs.timezone, prefs.dayStartHour) === day);
  const admitted = new Set(today.map(event => event.cardId));
  const newAdmissions = new Set(today.filter(event => event.before.schedule.state === "new").map(event => event.cardId));
  const reviewAdmissions = new Set(today.filter(event => event.before.schedule.state !== "new" && !newAdmissions.has(event.cardId)).map(event => event.cardId));
  let fresh = Math.max(0, prefs.newPerDay - newAdmissions.size), reviews = Math.max(0, prefs.reviewsPerDay - reviewAdmissions.size);
  const deckEntries = deckId ? new Set(state.entries.filter(entry => entry.deckId === deckId).map(entry => entry.id)) : null;
  const candidates = state.cards.filter(card => Date.parse(card.schedule.due) <= +at && (!deckEntries || deckEntries.has(card.entryId)))
    .sort((a, b) => Number(a.schedule.state === "new") - Number(b.schedule.state === "new") || Date.parse(a.schedule.due) - Date.parse(b.schedule.due) || a.id.localeCompare(b.id));
  return structuredClone(candidates.filter(card => {
    if (admitted.has(card.id)) return true;
    if (card.schedule.state === "new") return fresh-- > 0;
    return reviews-- > 0;
  }));
}

function shiftDay(day: string, offset: number): string {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}
export function progress(state: StudyState, at: Date) {
  const prefs = state.preferences;
  const today = studyDay(at, prefs.timezone, prefs.dayStartHour);
  const active = state.events.filter(event => !event.undoneAt && Date.parse(event.at) <= +at);
  const dated = active.map(event => ({ event, day: studyDay(new Date(event.at), prefs.timezone, prefs.dayStartHour) }));
  const recent = dated.filter(item => item.day >= shiftDay(today, -29));
  const dayOfWeek = new Date(`${today}T12:00:00Z`).getUTCDay();
  const monday = shiftDay(today, -(dayOfWeek + 6) % 7);
  const days = new Set(dated.map(item => item.day));
  let streak = 0, cursor = days.has(today) ? today : shiftDay(today, -1);
  while (days.has(cursor)) { streak++; cursor = shiftDay(cursor, -1); }
  const dueNext14Days = Array.from({ length: 14 }, (_, i) => ({ day: shiftDay(today, i), count: 0 }));
  for (const card of state.cards) {
    const due = studyDay(new Date(card.schedule.due), prefs.timezone, prefs.dayStartHour);
    const bucket = due <= today ? dueNext14Days[0] : dueNext14Days.find(item => item.day === due);
    if (bucket) bucket.count++;
  }
  return { reviewedThisWeek: dated.filter(item => item.day >= monday).length, reviewedLast30Days: recent.length,
    remembered: recent.length ? recent.filter(item => item.event.grade === "good" || item.event.grade === "easy").length / recent.length : null,
    streak, dueNext14Days, cardCount: state.cards.length };
}
