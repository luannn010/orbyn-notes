// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { createJournalEnvelope, unlockJournalEnvelope, sealJournalData, emptyJournal, writeJournalEntry, setHabitCompletion, validateJournalData, saveHabit, archiveHabit, journalMonth } from "../../src/collections/journal";
const context = { accountId: "11111111-1111-4111-8111-111111111111", epoch: "22222222-2222-4222-8222-222222222222" };
const passphrase = "synthetic Journal phrase only";
const current = () => {};
describe("separate Journal encryption boundary", () => {
  it("counts real writing and historical habits without treating prompts or visits as written days", () => {
    const createdAt = new Date(2026, 1, 10, 12);
    let data = saveHabit(emptyJournal(), "Read", createdAt);
    const habit = data.habits[0]!;
    data = setHabitCompletion(data, "2026-02-10", habit.id, true, createdAt);
    data = writeJournalEntry(data, "2026-02-10", { type: "doc", content: [{ type: "paragraph", content: [] }] }, "A prompt alone", createdAt);
    data = archiveHabit(data, habit.id, new Date(2026, 1, 12, 12));
    expect(setHabitCompletion(data, "2026-02-10", habit.id, false, createdAt).completions[0]!.done).toBe(false);
    expect(() => setHabitCompletion(data, "2026-02-13", habit.id, true, createdAt)).toThrow("unavailable");
    data = saveHabit(data, "Read a book", createdAt, habit.id);
    const month = journalMonth(data, 2026, 2);
    expect(month).toHaveLength(28);
    expect(month[8]).toMatchObject({ habitTotal: 0, written: false });
    expect(month[9]).toMatchObject({ habitTotal: 1, habitsCompleted: 1, written: false });
    expect(month[12]).toMatchObject({ habitTotal: 0 });
    expect(data.completions[0]!.habitId).toBe(habit.id);
    expect(data.entries).toHaveLength(1);
    expect(journalMonth(emptyJournal(), 2028, 2)).toHaveLength(29);
  });
  it("snapshots KDF metadata before encryption yields and rejects weaker AES keys", async () => {
    const created = await createJournalEnvelope(passphrase, emptyJournal(), context, current);
    const kdf = structuredClone(created.envelope.kdf);
    const originalSalt = kdf.salt;
    const realEncrypt = crypto.subtle.encrypt.bind(crypto.subtle);
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const spy = vi.spyOn(crypto.subtle, "encrypt").mockImplementation(async (algorithm, key, data) => { await gate; return realEncrypt(algorithm, key, data); });
    try {
      const pending = sealJournalData(created.key, kdf, emptyJournal(), context, current);
      kdf.salt = btoa("0123456789abcdef");
      release();
      const result = await pending;
      expect(result.kdf.salt).toBe(originalSalt);
      expect((await unlockJournalEnvelope(result, passphrase, context, current)).data).toEqual(emptyJournal());
    } finally { release(); spy.mockRestore(); }
    const weak = await crypto.subtle.generateKey({ name: "AES-GCM", length: 128 }, false, ["encrypt", "decrypt"]);
    await expect(sealJournalData(weak, created.envelope.kdf, emptyJournal(), context, current)).rejects.toThrow("invalid_journal_key");
  });
  it("requires its passphrase, authenticates account/epoch, and uses fresh IVs", async () => {
    const data = writeJournalEntry(emptyJournal(), "2026-11-11", { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Private synthetic Journal" }] }] }, "What felt important today?", new Date("2026-11-11T12:00:00Z"));
    const created = await createJournalEnvelope(passphrase, data, context, current);
    expect(created.key.extractable).toBe(false);
    expect(JSON.stringify(created.envelope)).not.toContain("Private synthetic");
    const opened = await unlockJournalEnvelope(created.envelope, passphrase, context, current);
    expect(opened.data).toEqual(data);
    const second = await sealJournalData(opened.key, created.envelope.kdf, data, context, current);
    expect(second.iv).not.toBe(created.envelope.iv);
    expect(second.ciphertext).not.toBe(created.envelope.ciphertext);
    await expect(unlockJournalEnvelope(created.envelope, "wrong synthetic phrase", context, current)).rejects.toThrow("unlock");
    await expect(unlockJournalEnvelope(created.envelope, passphrase, { ...context, epoch: crypto.randomUUID() }, current)).rejects.toThrow("unlock");
    await expect(unlockJournalEnvelope(created.envelope, passphrase, { ...context, accountId: crypto.randomUUID() }, current)).rejects.toThrow("unlock");
  });
  it("rejects revoked async completions and malformed KDF parameters", async () => {
    let valid = true;
    const guard = () => { if (!valid) throw new Error("locked"); };
    const pending = createJournalEnvelope(passphrase, emptyJournal(), context, guard);
    valid = false;
    await expect(pending).rejects.toThrow("locked");
    const created = await createJournalEnvelope(passphrase, emptyJournal(), context, current);
    const malformed = structuredClone(created.envelope);
    (malformed.kdf as { iterations: number }).iterations = 1;
    await expect(unlockJournalEnvelope(malformed, passphrase, context, current)).rejects.toThrow("collections_invalid");
    await expect(createJournalEnvelope("short", emptyJournal(), context, current)).rejects.toThrow("passphrase");
  });
  it("uses dated entries and stable habit identity without creating entries on visits", () => {
    const data = emptyJournal();
    const habitId = crypto.randomUUID();
    data.habits.push({ id: habitId, name: "Read", order: 0, createdAt: "2026-11-10T00:00:00.000Z", createdOn: "2026-11-10", archivedAt: null, archivedOn: null, revision: 1 });
    const next = setHabitCompletion(data, "2026-11-10", habitId, true, new Date("2026-11-11T12:00:00Z"));
    expect(next.entries).toHaveLength(0);
    expect(next.completions).toHaveLength(1);
    expect(setHabitCompletion(next, "2026-11-10", habitId, false, new Date()).completions[0]!.done).toBe(false);
    expect(() => setHabitCompletion(data, "2026-02-30", habitId, true, new Date())).toThrow("date");
    expect(() => validateJournalData({ ...next, completions: [...next.completions, ...next.completions] })).toThrow("journal_invalid");
  });
});
