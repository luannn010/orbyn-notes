// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createJournalEnvelope,
  emptyJournal,
  unlockJournalEnvelope,
} from "../../src/collections/journal";
import {
  openHabitDraft,
  sealHabitDraft,
  validateHabitFormDraft,
  sealProtectedForms,
  openProtectedForms,
  validateProtectedForms,
} from "../../src/collections/journalViewDraft";
import type { HabitFormDraft } from "../../src/collections/journalViewDraft";
import type { ProtectedFormDrafts } from "../../src/collections/journalViewDraft";
const context = {
  accountId: "11111111-1111-4111-8111-111111111111",
  epoch: "22222222-2222-4222-8222-222222222222",
};
const passphrase = "Synthetic recovery proof passphrase";
const draft: HabitFormDraft = {
  version: 1,
  mode: "create",
  id: null,
  name: "Unsubmitted private habit",
  originalName: "",
  dirty: true,
};
afterEach(() => vi.restoreAllMocks());
it("authenticates the combined form purpose and snapshots unfinished URL input before awaiting", async () => {
  const proof = await createJournalEnvelope(
    passphrase,
    emptyJournal(),
    context,
    () => {},
  );
  const forms: ProtectedFormDrafts = {
    version: 1,
    habit: draft,
    link: {
      version: 1,
      date: "2026-11-11",
      source: "toolbar",
      from: 1,
      to: 1,
      selection: { type: "all" },
      initialUrl: "",
      url: "private unfinished URL",
      entryId: null,
      entryRevision: 0,
      dirty: true,
    },
  };
  const pending = sealProtectedForms(proof.key, forms, context, () => {});
  forms.link!.url = "Changed after crypto started";
  const sealed = await pending;
  expect(JSON.stringify(sealed)).not.toContain("private unfinished URL");
  expect(
    (await openProtectedForms(proof.key, sealed, context, () => {})).link!.url,
  ).toBe("private unfinished URL");
  const second = await sealProtectedForms(proof.key, forms, context, () => {});
  expect(second.iv).not.toBe(sealed.iv);
  await expect(
    openProtectedForms(
      proof.key,
      sealed,
      { ...context, epoch: crypto.randomUUID() },
      () => {},
    ),
  ).rejects.toThrow();
  await expect(
    openHabitDraft(proof.key, sealed, context, () => {}),
  ).rejects.toThrow();
  const legacy = await sealHabitDraft(proof.key, draft, context, () => {});
  await expect(
    openProtectedForms(proof.key, legacy, context, () => {}),
  ).rejects.toThrow();
  expect(() =>
    validateProtectedForms({ ...forms, link: { ...forms.link, dirty: false } }),
  ).toThrow();
});
describe("memory-only habit draft crypto", () => {
  it("uses fresh IVs and a distinct authenticated purpose/account/epoch", async () => {
    const proof = await createJournalEnvelope(
      passphrase,
      emptyJournal(),
      context,
      () => {},
    );
    const first = await sealHabitDraft(proof.key, draft, context, () => {}),
      second = await sealHabitDraft(proof.key, draft, context, () => {});
    expect(first.iv).not.toBe(second.iv);
    expect(first.iv).not.toBe(proof.envelope.iv);
    expect(JSON.stringify(first)).not.toContain(draft.name);
    expect(await openHabitDraft(proof.key, first, context, () => {})).toEqual(
      draft,
    );
    await expect(
      openHabitDraft(
        proof.key,
        first,
        { ...context, epoch: crypto.randomUUID() },
        () => {},
      ),
    ).rejects.toThrow();
    await expect(
      openHabitDraft(
        proof.key,
        first,
        { ...context, accountId: crypto.randomUUID() },
        () => {},
      ),
    ).rejects.toThrow();
    await expect(
      openHabitDraft(
        proof.key,
        {
          version: 1,
          iv: proof.envelope.iv,
          ciphertext: proof.envelope.ciphertext,
        },
        context,
        () => {},
      ),
    ).rejects.toThrow();
    await expect(
      unlockJournalEnvelope(
        { ...proof.envelope, iv: first.iv, ciphertext: first.ciphertext },
        passphrase,
        context,
        () => {},
      ),
    ).rejects.toThrow();
  });
  it("snapshots input before awaits and rejects stale encryption/decryption results", async () => {
    const proof = await createJournalEnvelope(
      passphrase,
      emptyJournal(),
      context,
      () => {},
    );
    const source = structuredClone(draft),
      original = crypto.subtle.encrypt.bind(crypto.subtle);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.spyOn(crypto.subtle, "encrypt").mockImplementationOnce(
      async (algorithm, key, data) => {
        await gate;
        return original(algorithm, key, data);
      },
    );
    const pending = sealHabitDraft(proof.key, source, context, () => {});
    source.name = "Changed outside owner";
    release();
    const envelope = await pending;
    expect(
      (await openHabitDraft(proof.key, envelope, context, () => {})).name,
    ).toBe(draft.name);
    let fresh = true;
    const current = () => {
      if (!fresh) throw new Error("revoked");
    };
    const encrypting = sealHabitDraft(proof.key, draft, context, current);
    fresh = false;
    await expect(encrypting).rejects.toThrow("revoked");
    fresh = true;
    const decrypting = openHabitDraft(proof.key, envelope, context, current);
    fresh = false;
    await expect(decrypting).rejects.toThrow("revoked");
  });
  it("rejects malformed, oversized and falsely-clean drafts before crypto", async () => {
    const proof = await createJournalEnvelope(
      passphrase,
      emptyJournal(),
      context,
      () => {},
    );
    for (const malformed of [
      { ...draft, dirty: false },
      { ...draft, name: "x".repeat(201) },
      { ...draft, extra: "not allowed" },
      { ...draft, mode: "edit", id: null },
    ])
      expect(() => validateHabitFormDraft(malformed)).toThrow();
    const decrypt = vi.spyOn(crypto.subtle, "decrypt");
    await expect(
      openHabitDraft(
        proof.key,
        {
          version: 1,
          iv: btoa("i".repeat(12)),
          ciphertext: btoa("x".repeat(16385)),
        },
        context,
        () => {},
      ),
    ).rejects.toThrow();
    expect(decrypt).not.toHaveBeenCalled();
    const weak = await crypto.subtle.generateKey(
      { name: "AES-GCM", length: 128 },
      false,
      ["encrypt", "decrypt"],
    );
    await expect(
      sealHabitDraft(weak, draft, context, () => {}),
    ).rejects.toThrow();
  });
});
