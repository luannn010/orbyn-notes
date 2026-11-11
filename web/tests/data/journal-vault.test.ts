// @vitest-environment node
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { readFile } from "node:fs/promises";
import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import { initSync, DeviceKeys } from "../../src/generated/wasm/orbyn_wasm.js";
import { openCollectionsStore } from "../../src/collections/store";
import { openJournalVault } from "../../src/collections/journalVault";
import { writeJournalEntry } from "../../src/collections/journal";
import {
  newWrappingKey,
  wrappingSecret,
  mutateRecord,
  readRecord,
} from "../../src/data/database";
import type { DeviceRecord } from "../../src/data/database";
import { establish, lock as lockAccount } from "../../src/account/session";
import { openNotesStore } from "../../src/data";
import { unlockJournalEnvelope } from "../../src/collections/journal";
import { saveHabit } from "../../src/collections/journal";
import type {
  HabitFormDraft,
  HabitFormInput,
} from "../../src/collections/journalViewDraft";

type HabitVault = Awaited<ReturnType<typeof openJournalVault>> & {
  readHabitDraft(): HabitFormDraft | null;
  setHabitDraft(input: HabitFormInput): void;
  saveHabitDraft(): Promise<void>;
  discardHabitDraft(): void;
};

const identity = {
  accountId: "11111111-1111-4111-8111-111111111111",
  deviceId: "22222222-2222-4222-8222-222222222222",
  email: "vault@example.test",
  deviceState: "trusted" as const,
};
const passphrase = "Synthetic vault passphrase only";
const handles = new Set<{ close(): void }>();
const at = new Date("2026-11-11T12:00:00.000Z");
const document = {
  type: "doc" as const,
  content: [
    {
      type: "paragraph",
      content: [{ type: "text", text: "Private recoverable synthetic draft" }],
    },
  ],
};
async function open() {
  const store = await openCollectionsStore(identity);
  handles.add(store);
  const vault = await openJournalVault(identity, store);
  handles.add(vault);
  return { store, vault };
}
beforeAll(async () => {
  initSync({
    module: await readFile(
      new URL("../../src/generated/wasm/orbyn_wasm_bg.wasm", import.meta.url),
    ),
  });
});
beforeEach(async () => {
  lockAccount();
  vi.stubGlobal("indexedDB", new IDBFactory());
  const wrapKey = await newWrappingKey(),
    secret = await wrappingSecret(wrapKey),
    keys = DeviceKeys.create();
  try {
    await mutateRecord<DeviceRecord>("devices", identity.email, () => ({
      ...identity,
      wrapKey,
      sealedKeys: keys.export(secret),
      generation: 0,
    }));
  } finally {
    secret.fill(0);
    keys.free();
  }
  establish(identity);
});
afterEach(() => {
  for (const handle of handles) handle.close();
  handles.clear();
  vi.restoreAllMocks();
  vi.useRealTimers();
  lockAccount();
  vi.unstubAllGlobals();
});

describe("protected unfinished Journal links", () => {
  const input = {
    date: "2026-11-11",
    source: "toolbar" as const,
    from: 1,
    to: 1,
    selection: { type: "text" as const, anchor: 1, head: 1 },
    initialUrl: "",
    url: "https://example.test/private-unsubmitted",
  };
  it("keeps unfinished URLs memory-only, sealed through lock, and guarded until explicit cancel", async () => {
    const { store, vault } = await open();
    await vault.create(passphrase);
    const before = await store.read();
    vault.setLinkDraft(input);
    expect((await store.read()).journal).toEqual(before.journal);
    expect(vault.read().entries).toHaveLength(0);
    expect(vault.canClose()).toBe(false);
    const locking = vault.lock();
    expect(() => vault.readLinkDraft()).toThrow();
    await locking;
    expect(vault.status().linkDraftDirty).toBe(true);
    expect(JSON.stringify(vault.status())).not.toContain(input.url);
    await expect(vault.unlock("Wrong synthetic passphrase")).rejects.toThrow();
    expect(() => vault.readLinkDraft()).toThrow();
    await vault.unlock(passphrase);
    expect(vault.readLinkDraft()).toMatchObject({
      ...input,
      entryId: null,
      entryRevision: 0,
      dirty: true,
    });
    vault.discardLinkDraft();
    expect(vault.canClose()).toBe(true);
  });
  it("requires this exact synchronous accepted document change before clearing intent", async () => {
    const { vault } = await open();
    await vault.create(passphrase);
    vault.setLinkDraft(input);
    const applied = {
      type: "doc" as const,
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "Actual link",
              marks: [{ type: "link", attrs: { href: input.url } }],
            },
          ],
        },
      ],
    };
    const ticket = vault.beginLinkApply();
    expect(() =>
      vault.completeLinkDraft(ticket, { document: applied, changed: true }),
    ).toThrow("not accepted");
    expect(() =>
      vault.completeLinkDraft(ticket, { document: applied, changed: false }),
    ).toThrow("not applied");
    const fresh = vault.beginLinkApply();
    const saving = vault.update((data) =>
      writeJournalEntry(data, input.date, applied, null, at),
    );
    vault.completeLinkDraft(fresh, { document: applied, changed: true });
    await saving;
    expect(vault.readLinkDraft()).toBeNull();
    expect(vault.canClose()).toBe(true);
    expect(vault.read().entries[0]!.document).toEqual(applied);
  });
  it("does not apply old positions to an entry changed after the form opened", async () => {
    const { vault } = await open();
    await vault.create(passphrase);
    vault.setLinkDraft(input);
    await vault.update((data) =>
      writeJournalEntry(data, input.date, document, null, at),
    );
    expect(() => vault.beginLinkApply()).toThrow("text changed");
    expect(vault.readLinkDraft()!.url).toBe(input.url);
    await vault.lock();
    await vault.unlock(passphrase);
    expect(() => vault.beginLinkApply()).toThrow("text changed");
    expect(vault.read().entries[0]!.document).toEqual(document);
  });
  it("retains an applied URL in the body draft if encrypted persistence fails", async () => {
    const { vault } = await open();
    await vault.create(passphrase);
    vault.setLinkDraft(input);
    const applied = {
      type: "doc" as const,
      content: [
        { type: "paragraph", content: [{ type: "text", text: input.url }] },
      ],
    };
    const ticket = vault.beginLinkApply();
    vi.spyOn(IDBObjectStore.prototype, "put").mockImplementationOnce(() => {
      throw new DOMException("Synthetic quota", "QuotaExceededError");
    });
    const saving = vault.update((data) =>
      writeJournalEntry(data, input.date, applied, null, at),
    );
    vault.completeLinkDraft(ticket, { document: applied, changed: true });
    await expect(saving).rejects.toThrow();
    expect(vault.status().dirty).toBe(true);
    expect(vault.canClose()).toBe(false);
    await vault.lock();
    await vault.unlock(passphrase);
    expect(vault.read().entries[0]!.document).toEqual(applied);
    await vault.retry();
    expect(vault.canClose()).toBe(true);
  });
  it("revokes pending URL recovery on account lock", async () => {
    const { vault } = await open();
    await vault.create(passphrase);
    vault.setLinkDraft(input);
    await vault.lock();
    lockAccount();
    expect(vault.status().phase).toBe("revoked");
    expect(vault.status().linkDraftDirty).toBe(false);
    await expect(vault.unlock(passphrase)).rejects.toThrow();
    expect(() => vault.readLinkDraft()).toThrow();
  });
});

describe("Journal vault lease and hidden recovery", () => {
  it.each(["create", "edit"] as const)(
    "recovers an unsubmitted %s habit only after passphrase proof",
    async (mode) => {
      const opened = await open();
      const vault = opened.vault as HabitVault;
      await vault.create(passphrase);
      if (mode === "edit")
        await vault.update((data) =>
          saveHabit(data, "Original synthetic habit", at),
        );
      const before = await opened.store.read(),
        original = vault.read();
      const id = mode === "edit" ? original.habits[0]!.id : null;
      vault.setHabitDraft({ mode, id, name: "Typed but not submitted" });
      expect(vault.canClose()).toBe(false);
      expect(vault.read().habits).toEqual(original.habits);
      const locking = vault.lock();
      expect(() => vault.readHabitDraft()).toThrow();
      await locking;
      expect(vault.status().pendingRecovery).toBe(true);
      expect(vault.canClose()).toBe(false);
      expect((await opened.store.read()).journal).toEqual(before.journal);
      await expect(
        vault.unlock("Wrong synthetic passphrase"),
      ).rejects.toThrow();
      expect(() => vault.readHabitDraft()).toThrow();
      await vault.unlock(passphrase);
      expect(vault.readHabitDraft()).toMatchObject({
        mode,
        id,
        name: "Typed but not submitted",
        dirty: true,
      });
      expect(vault.read().habits).toEqual(original.habits);
      await vault.saveHabitDraft();
      expect(vault.read().habits).toHaveLength(1);
      expect(vault.read().habits[0]!.name).toBe("Typed but not submitted");
      expect(vault.readHabitDraft()).toBeNull();
      expect(vault.canClose()).toBe(true);
    },
  );
  it.each(["create", "edit"] as const)(
    "recovers unsaved %s habit intent after automatic away lock",
    async (mode) => {
      const opened = await open();
      const vault = opened.vault as HabitVault;
      await vault.create(passphrase);
      if (mode === "edit")
        await vault.update((data) => saveHabit(data, "Original habit", at));
      const id = mode === "edit" ? vault.read().habits[0]!.id : null;
      vault.setHabitDraft({ mode, id, name: "Private away-lock input" });
      const stored = (await opened.store.read()).journal;
      const locked = new Promise<void>((resolve) => {
        const stop = vault.subscribe(() => {
          if (vault.status().phase === "locked") {
            stop();
            resolve();
          }
        });
      });
      vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
      vault.setAway(true);
      await vi.advanceTimersByTimeAsync(60000);
      expect(() => vault.readHabitDraft()).toThrow();
      await locked;
      expect(vault.canClose()).toBe(false);
      vault.setAway(false);
      vi.useRealTimers();
      await vault.unlock(passphrase);
      expect(vault.readHabitDraft()).toMatchObject({
        mode,
        id,
        name: "Private away-lock input",
        dirty: true,
      });
      expect((await opened.store.read()).journal).toEqual(stored);
    },
  );
  it("derives dirty intent, isolates caller objects, and cancels only the form explicitly", async () => {
    const { vault: original, store } = await open();
    const vault = original as HabitVault;
    await vault.create(passphrase);
    const before = await store.read();
    vault.setHabitDraft({ mode: "create", id: null, name: "" });
    expect(vault.canClose()).toBe(true);
    const input: HabitFormInput = {
      mode: "create",
      id: null,
      name: "Private intent",
    };
    vault.setHabitDraft(input);
    input.name = "Outside mutation";
    const returned = vault.readHabitDraft()!;
    returned.name = "Changed projection";
    expect(vault.readHabitDraft()!.name).toBe("Private intent");
    expect(() =>
      vault.setHabitDraft({
        mode: "create",
        id: null,
        name: "secret",
        dirty: false,
      } as unknown as HabitFormInput),
    ).toThrow();
    expect(() =>
      vault.setHabitDraft({
        mode: "edit",
        id: crypto.randomUUID(),
        name: "Different form",
      }),
    ).toThrow();
    vault.discardHabitDraft();
    expect(vault.readHabitDraft()).toBeNull();
    expect(vault.canClose()).toBe(true);
    expect(await store.read()).toEqual(before);
  });
  it("retries failed new-habit Save with its stable ID and does not create duplicates", async () => {
    const { vault: original } = await open();
    const vault = original as HabitVault;
    await vault.create(passphrase);
    vault.setHabitDraft({ mode: "create", id: null, name: "Save once" });
    const put = vi
      .spyOn(IDBObjectStore.prototype, "put")
      .mockImplementationOnce(() => {
        throw new DOMException("Synthetic quota", "QuotaExceededError");
      });
    await expect(vault.saveHabitDraft()).rejects.toThrow();
    put.mockRestore();
    const id = vault.readHabitDraft()!.id;
    expect(id).not.toBeNull();
    expect(vault.read().habits).toHaveLength(1);
    await vault.lock();
    await vault.unlock(passphrase);
    expect(vault.readHabitDraft()).toMatchObject({
      mode: "edit",
      id,
      name: "Save once",
    });
    await vault.saveHabitDraft();
    expect(vault.read().habits).toHaveLength(1);
    expect(vault.read().habits[0]!.id).toBe(id);
    expect(vault.readHabitDraft()).toBeNull();
    expect(vault.canClose()).toBe(true);
  });
  it("keeps newer typed input when an older habit Save commits", async () => {
    const { vault: original } = await open();
    const vault = original as HabitVault;
    await vault.create(passphrase);
    vault.setHabitDraft({ mode: "create", id: null, name: "First name" });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const real = crypto.subtle.encrypt.bind(crypto.subtle);
    const encrypt = vi
      .spyOn(crypto.subtle, "encrypt")
      .mockImplementationOnce(async (algorithm, key, data) => {
        await gate;
        return real(algorithm, key, data);
      });
    const saving = vault.saveHabitDraft();
    const id = vault.readHabitDraft()!.id;
    await vi.waitFor(() => expect(encrypt).toHaveBeenCalled());
    vault.setHabitDraft({ mode: "edit", id, name: "Newer name" });
    release();
    await saving;
    expect(vault.readHabitDraft()).toMatchObject({
      id,
      name: "Newer name",
      dirty: true,
    });
    expect(vault.read().habits[0]!.name).toBe("First name");
    expect(vault.canClose()).toBe(false);
    await vault.saveHabitDraft();
    expect(vault.read().habits).toHaveLength(1);
    expect(vault.read().habits[0]!.name).toBe("Newer name");
  });
  it.each([1, 2])(
    "keeps both private recovery pieces when seal %i fails",
    async (failingSeal) => {
      const { vault: original } = await open();
      const vault = original as HabitVault;
      await vault.create(passphrase);
      const put = vi
        .spyOn(IDBObjectStore.prototype, "put")
        .mockImplementationOnce(() => {
          throw new DOMException("Synthetic quota", "QuotaExceededError");
        });
      await expect(
        vault.update((data) =>
          writeJournalEntry(data, "2026-11-11", document, null, at),
        ),
      ).rejects.toThrow();
      put.mockRestore();
      vault.setHabitDraft({
        mode: "create",
        id: null,
        name: "Unsubmitted paired recovery",
      });
      const real = crypto.subtle.encrypt.bind(crypto.subtle);
      let seals = 0;
      const encrypt = vi
        .spyOn(crypto.subtle, "encrypt")
        .mockImplementation(async (algorithm, key, data) => {
          if (++seals === failingSeal)
            throw new Error("Synthetic pair seal failure");
          return real(algorithm, key, data);
        });
      const locking = vault.lock();
      expect(() => vault.read()).toThrow();
      expect(() => vault.readHabitDraft()).toThrow();
      await expect(locking).rejects.toThrow("pair seal");
      encrypt.mockRestore();
      expect(vault.status().phase).toBe("lock-error");
      expect(vault.canClose()).toBe(false);
      await expect(
        vault.unlock("Wrong synthetic passphrase"),
      ).rejects.toThrow();
      await vault.unlock(passphrase);
      expect(vault.read().entries[0]!.document).toEqual(document);
      expect(vault.readHabitDraft()!.name).toBe("Unsubmitted paired recovery");
      vault.discardHabitDraft();
      expect(vault.canClose()).toBe(false);
      await vault.retry();
      expect(vault.canClose()).toBe(true);
    },
  );
  it.each(["account", "erase"] as const)(
    "revokes a pending habit-draft seal on %s invalidation",
    async (reason) => {
      const { vault: original, store } = await open();
      const vault = original as HabitVault;
      await vault.create(passphrase);
      const notes = await openNotesStore(identity);
      handles.add(notes);
      vault.setHabitDraft({
        mode: "create",
        id: null,
        name: "Never republish revoked input",
      });
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const real = crypto.subtle.encrypt.bind(crypto.subtle);
      const encrypt = vi
        .spyOn(crypto.subtle, "encrypt")
        .mockImplementationOnce(async (algorithm, key, data) => {
          await gate;
          return real(algorithm, key, data);
        });
      const locking = vault.lock();
      await vi.waitFor(() => expect(encrypt).toHaveBeenCalled());
      if (reason === "erase") {
        await notes.erase();
        await store.read();
      } else establish(identity);
      release();
      await expect(locking).rejects.toThrow("journal_stale");
      expect(vault.status()).toMatchObject({
        phase: "revoked",
        habitDraftDirty: false,
        pendingRecovery: false,
      });
      expect(() => vault.readHabitDraft()).toThrow();
    },
  );
  it("does not publish either piece if account lock arrives while form decryption is pending", async () => {
    const { vault: original } = await open();
    const vault = original as HabitVault;
    await vault.create(passphrase);
    vault.setHabitDraft({
      mode: "create",
      id: null,
      name: "No late form exposure",
    });
    await vault.lock();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const real = crypto.subtle.decrypt.bind(crypto.subtle);
    let calls = 0,
      blocked = false;
    vi.spyOn(crypto.subtle, "decrypt").mockImplementation(
      async (algorithm, key, data) => {
        if (++calls === 2) {
          blocked = true;
          await gate;
        }
        return real(algorithm, key, data);
      },
    );
    let exposed = false;
    vault.subscribe(() => {
      if (vault.status().phase === "unlocked") exposed = true;
    });
    const unlocking = vault.unlock(passphrase);
    await vi.waitFor(() => expect(blocked).toBe(true));
    establish(identity);
    release();
    await expect(unlocking).rejects.toThrow("journal_stale");
    expect(exposed).toBe(false);
    expect(() => vault.readHabitDraft()).toThrow();
  });
  it("creates a separate encrypted vault and publishes data only after passphrase unlock", async () => {
    const { store, vault } = await open();
    expect(() => vault.read()).toThrow();
    await vault.create(passphrase);
    await vault.update((data) =>
      writeJournalEntry(data, "2026-11-11", document, null, at),
    );
    expect(vault.read().entries[0]?.document).toEqual(document);
    const locking = vault.lock();
    expect(() => vault.read()).toThrow();
    await locking;
    expect(vault.status().phase).toBe("locked");
    await expect(vault.unlock("Wrong synthetic passphrase")).rejects.toThrow();
    expect(() => vault.read()).toThrow();
    await vault.unlock(passphrase);
    expect(vault.read().entries[0]?.document).toEqual(document);
    const persisted = (await readRecord<DeviceRecord>(
      "devices",
      identity.email,
    ))!;
    expect(new TextDecoder().decode(persisted.snapshot)).not.toContain(
      "Private recoverable",
    );
    expect(JSON.stringify((await store.read()).journal)).not.toContain(
      "Private recoverable",
    );
  });
  it("seals a failed-save draft behind lock and restores it only after correct unlock", async () => {
    const { vault } = await open();
    await vault.create(passphrase);
    const put = vi
      .spyOn(IDBObjectStore.prototype, "put")
      .mockImplementationOnce(() => {
        throw new DOMException("Synthetic quota", "QuotaExceededError");
      });
    await expect(
      vault.update((data) =>
        writeJournalEntry(data, "2026-11-11", document, null, at),
      ),
    ).rejects.toThrow();
    put.mockRestore();
    expect(vault.status().dirty).toBe(true);
    expect(vault.canClose()).toBe(false);
    const locking = vault.lock();
    expect(() => vault.read()).toThrow();
    await locking;
    expect(vault.status().pendingRecovery).toBe(true);
    expect(vault.canClose()).toBe(false);
    await expect(vault.unlock("Wrong synthetic passphrase")).rejects.toThrow();
    await vault.unlock(passphrase);
    expect(vault.read().entries[0]?.document).toEqual(document);
    await vault.retry();
    expect(vault.status().dirty).toBe(false);
    expect(vault.canClose()).toBe(true);
  });
  it("hides a draft synchronously even if sealing fails and recovers only after explicit passphrase unlock", async () => {
    const { vault } = await open();
    await vault.create(passphrase);
    const put = vi
      .spyOn(IDBObjectStore.prototype, "put")
      .mockImplementationOnce(() => {
        throw new DOMException("Synthetic quota", "QuotaExceededError");
      });
    await expect(
      vault.update((data) =>
        writeJournalEntry(data, "2026-11-11", document, null, at),
      ),
    ).rejects.toThrow();
    put.mockRestore();
    const encrypt = vi
      .spyOn(crypto.subtle, "encrypt")
      .mockRejectedValueOnce(new Error("Synthetic crypto failure"));
    const locking = vault.lock();
    expect(() => vault.read()).toThrow();
    await expect(locking).rejects.toThrow("Synthetic crypto failure");
    encrypt.mockRestore();
    expect(vault.status().phase).toBe("lock-error");
    expect(vault.canClose()).toBe(false);
    expect(JSON.stringify(vault.status())).not.toContain("Private recoverable");
    await expect(vault.unlock("Wrong synthetic passphrase")).rejects.toThrow();
    expect(() => vault.read()).toThrow();
    await vault.unlock(passphrase);
    expect(vault.read().entries[0]?.document).toEqual(document);
    await vault.retry();
    expect(vault.status().dirty).toBe(false);
  });
  it("fails enrollment closed when encryption fails before there is an authenticated recovery proof", async () => {
    const { vault, store } = await open();
    vi.spyOn(crypto.subtle, "encrypt").mockRejectedValueOnce(
      new Error("Synthetic enrollment crypto failure"),
    );
    await expect(vault.create(passphrase)).rejects.toThrow(
      "Synthetic enrollment",
    );
    expect(vault.status()).toMatchObject({
      phase: "locked",
      dirty: false,
      pendingRecovery: false,
      hasJournal: false,
    });
    expect(() => vault.read()).toThrow();
    expect((await store.read()).journal).toBeNull();
    expect(vault.canClose()).toBe(true);
  });
  it("rejects enrollment that completes after erase", async () => {
    const { vault, store } = await open();
    const notes = await openNotesStore(identity);
    handles.add(notes);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const real = crypto.subtle.deriveKey.bind(crypto.subtle);
    const derive = vi
      .spyOn(crypto.subtle, "deriveKey")
      .mockImplementationOnce(
        async (algorithm, baseKey, derivedKeyType, extractable, usages) => {
          await gate;
          return real(algorithm, baseKey, derivedKeyType, extractable, usages);
        },
      );
    const enrolling = vault.create(passphrase);
    await vi.waitFor(() => expect(derive).toHaveBeenCalled());
    expect(vault.canClose()).toBe(false);
    await notes.erase();
    await store.read();
    release();
    await expect(enrolling).rejects.toThrow("journal_stale");
    expect(vault.status().phase).toBe("revoked");
    expect(() => vault.read()).toThrow();
    expect((await store.read()).journal).toBeNull();
  });
  it("rejects a decrypt result after same-account reauthentication", async () => {
    const { vault } = await open();
    await vault.create(passphrase);
    await vault.lock();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const real = crypto.subtle.decrypt.bind(crypto.subtle);
    const decrypt = vi
      .spyOn(crypto.subtle, "decrypt")
      .mockImplementationOnce(async (algorithm, key, data) => {
        await gate;
        return real(algorithm, key, data);
      });
    const opening = vault.unlock(passphrase);
    await vi.waitFor(() => expect(decrypt).toHaveBeenCalled());
    establish(identity);
    release();
    await expect(opening).rejects.toThrow("journal_stale");
    expect(vault.status().phase).toBe("revoked");
    expect(() => vault.read()).toThrow();
  });
  it("registers epoch revocation before the initial asynchronous read", async () => {
    const store = await openCollectionsStore(identity);
    handles.add(store);
    const notes = await openNotesStore(identity);
    handles.add(notes);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const realRead = store.read.bind(store);
    const reading = vi.spyOn(store, "read").mockImplementationOnce(async () => {
      const result = await realRead();
      await gate;
      return result;
    });
    const opening = openJournalVault(identity, store);
    await vi.waitFor(() => expect(reading).toHaveBeenCalled());
    await notes.erase();
    await realRead();
    release();
    await expect(opening).rejects.toThrow("journal_stale");
  });
  it("rejects a save whose generation changes while the store is awaiting wrapping crypto", async () => {
    const { vault, store } = await open();
    await vault.create(passphrase);
    const before = (await store.read()).journal;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let sealed = false,
      afterSealSigns = 0,
      blocked = false;
    const realEncrypt = crypto.subtle.encrypt.bind(crypto.subtle),
      realSign = crypto.subtle.sign.bind(crypto.subtle);
    vi.spyOn(crypto.subtle, "encrypt").mockImplementation(
      async (algorithm, key, data) => {
        const result = await realEncrypt(algorithm, key, data);
        sealed = true;
        return result;
      },
    );
    vi.spyOn(crypto.subtle, "sign").mockImplementation(
      async (algorithm, key, data) => {
        // After sealing: explicit freshness read, saving-state subscriber read,
        // then the actual replacement transaction's wrapping preparation.
        if (sealed && ++afterSealSigns === 3) {
          blocked = true;
          await gate;
        }
        return realSign(algorithm, key, data);
      },
    );
    const saving = vault.update((data) =>
      writeJournalEntry(data, "2026-11-11", document, null, at),
    );
    await vi.waitFor(() => expect(blocked).toBe(true));
    await vault.lock();
    release();
    await expect(saving).rejects.toThrow("journal_stale");
    expect((await store.read()).journal).toEqual(before);
    expect(vault.status()).toMatchObject({
      phase: "locked",
      pendingRecovery: true,
      dirty: true,
    });
    await vault.unlock(passphrase);
    expect(vault.read().entries[0]?.document).toEqual(document);
    await vault.retry();
  });
  it("retains and commits the newest draft while a previous save is pending", async () => {
    const { vault, store } = await open();
    await vault.create(passphrase);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const real = crypto.subtle.encrypt.bind(crypto.subtle);
    const encrypt = vi
      .spyOn(crypto.subtle, "encrypt")
      .mockImplementationOnce(async (algorithm, key, data) => {
        await gate;
        return real(algorithm, key, data);
      });
    const first = vault.update((data) =>
      writeJournalEntry(data, "2026-11-11", document, null, at),
    );
    await vi.waitFor(() => expect(encrypt).toHaveBeenCalled());
    const latestDocument = {
      type: "doc" as const,
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Newest synthetic draft" }],
        },
      ],
    };
    const second = vault.update((data) =>
      writeJournalEntry(data, "2026-11-11", latestDocument, null, at),
    );
    release();
    await Promise.all([first, second]);
    expect(vault.read().entries[0]?.document).toEqual(latestDocument);
    const persisted = await store.read();
    const opened = await unlockJournalEnvelope(
      persisted.journal!,
      passphrase,
      { accountId: identity.accountId, epoch: persisted.epoch },
      () => {},
    );
    expect(opened.data.entries[0]?.document).toEqual(latestDocument);
    expect(vault.status().dirty).toBe(false);
  });
  it("does not overwrite another vault envelope and requires explicit conflict discard", async () => {
    const first = await open();
    await first.vault.create(passphrase);
    const second = await open();
    await second.vault.unlock(passphrase);
    const put = vi
      .spyOn(IDBObjectStore.prototype, "put")
      .mockImplementationOnce(() => {
        throw new DOMException("Synthetic quota", "QuotaExceededError");
      });
    await expect(
      second.vault.update((data) =>
        writeJournalEntry(data, "2026-11-11", document, null, at),
      ),
    ).rejects.toThrow();
    put.mockRestore();
    const other = {
      type: "doc" as const,
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Another window won" }],
        },
      ],
    };
    await first.vault.update((data) =>
      writeJournalEntry(data, "2026-11-11", other, null, at),
    );
    await expect(second.vault.retry()).rejects.toThrow();
    expect(second.vault.read().entries[0]?.document).toEqual(document);
    const saved = (await first.store.read()).journal;
    await second.vault.lock();
    await second.vault.unlock(passphrase);
    expect(second.vault.status().conflict).toBe(true);
    expect(second.vault.read().entries[0]?.document).toEqual(document);
    await second.vault.discardAndReload();
    expect(() => second.vault.read()).toThrow();
    expect(second.vault.status()).toMatchObject({
      phase: "locked",
      dirty: false,
      pendingRecovery: false,
    });
    await second.vault.unlock(passphrase);
    expect(second.vault.read().entries[0]?.document).toEqual(other);
    expect((await first.store.read()).journal).toEqual(saved);
  });
  it("recognizes an unknown-result commit and refreshes Study-only revisions safely", async () => {
    const { vault, store } = await open();
    await vault.create(passphrase);
    const post = vi
      .spyOn(BroadcastChannel.prototype, "postMessage")
      .mockImplementationOnce(() => {
        throw new Error("Synthetic notification failure");
      });
    await expect(
      vault.update((data) =>
        writeJournalEntry(data, "2026-11-11", document, null, at),
      ),
    ).rejects.toThrow();
    post.mockRestore();
    const committed = await store.read();
    await vault.retry();
    expect((await store.read()).revision).toBe(committed.revision);
    expect(vault.status().dirty).toBe(false);
    const put = vi
      .spyOn(IDBObjectStore.prototype, "put")
      .mockImplementationOnce(() => {
        throw new DOMException("Synthetic quota", "QuotaExceededError");
      });
    await expect(
      vault.update((data) => ({
        ...data,
        preferences: { ...data.preferences, promptEnabled: false },
      })),
    ).rejects.toThrow();
    put.mockRestore();
    await store.update(await store.read(), (state) => ({
      ...state,
      study: {
        ...state.study,
        preferences: { ...state.study.preferences, showStreak: false },
      },
    }));
    await vault.retry();
    expect((await store.read()).study.preferences.showStreak).toBe(false);
    expect(vault.read().preferences.promptEnabled).toBe(false);
  });
  it("locks only after one minute continuously away and releases timers and browser listeners", async () => {
    const browserDocument = Object.assign(new EventTarget(), {
      hidden: false,
      hasFocus: () => true,
    });
    const browserWindow = new EventTarget();
    vi.stubGlobal("document", browserDocument);
    vi.stubGlobal("window", browserWindow);
    const removeDocument = vi.spyOn(browserDocument, "removeEventListener"),
      removeWindow = vi.spyOn(browserWindow, "removeEventListener");
    const { vault } = await open();
    await vault.create(passphrase);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    vault.setAway(true);
    await vi.advanceTimersByTimeAsync(59999);
    expect(vault.status().phase).toBe("unlocked");
    vault.setAway(false);
    await vi.advanceTimersByTimeAsync(1000);
    expect(vault.status().phase).toBe("unlocked");
    vault.setAway(true);
    await vi.advanceTimersByTimeAsync(60000);
    expect(vault.status().phase).toBe("locked");
    vault.close();
    expect(vi.getTimerCount()).toBe(0);
    expect(removeDocument).toHaveBeenCalled();
    expect(removeWindow).toHaveBeenCalledTimes(2);
    expect(() => vault.read()).toThrow();
  });
  it("locks synchronously on return when an overdue away timer never ran", async () => {
    const { vault } = await open();
    await vault.create(passphrase);
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vault.setAway(true);
    vi.setSystemTime(Date.now() + 60001); // Sleep advances the clock without delivering callbacks.
    vault.setAway(false);
    expect(() => vault.read()).toThrow();
    expect(vault.status().phase).toBe("locked");
  });
  it("locks synchronously when focus returns before an overdue timer callback", async () => {
    const browserDocument = Object.assign(new EventTarget(), {
      hidden: false,
      hasFocus: () => true,
    });
    const browserWindow = new EventTarget();
    vi.stubGlobal("document", browserDocument);
    vi.stubGlobal("window", browserWindow);
    const { vault } = await open();
    await vault.create(passphrase);
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    browserWindow.dispatchEvent(new Event("blur"));
    vi.setSystemTime(Date.now() + 60001);
    browserWindow.dispatchEvent(new Event("focus"));
    expect(() => vault.read()).toThrow();
    expect(vault.status().phase).toBe("locked");
  });
  it.each([false, true])(
    "never publishes a pending unlock after overdue absence (return=%s)",
    async (returned) => {
      const { vault } = await open();
      await vault.create(passphrase);
      await vault.lock();
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const real = crypto.subtle.decrypt.bind(crypto.subtle);
      const decrypt = vi
        .spyOn(crypto.subtle, "decrypt")
        .mockImplementationOnce(async (algorithm, key, data) => {
          await gate;
          return real(algorithm, key, data);
        });
      let publishedUnlocked = false;
      vault.subscribe(() => {
        if (vault.status().phase === "unlocked") publishedUnlocked = true;
      });
      const opening = vault.unlock(passphrase);
      await vi.waitFor(() => expect(decrypt).toHaveBeenCalled());
      vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
      vault.setAway(true);
      vi.setSystemTime(Date.now() + 60001);
      if (returned) vault.setAway(false);
      release();
      await expect(opening).rejects.toThrow("journal_stale");
      expect(publishedUnlocked).toBe(false);
      expect(() => vault.read()).toThrow();
      expect(vault.status().phase).toBe("locked");
    },
  );
});

it("JV-CLOSE-1 revokes unlocked plaintext and private forms before borrowed owner close returns", async () => {
  const { store, vault } = await open();
  await vault.create(passphrase);
  await vault.update((data) =>
    writeJournalEntry(data, "2026-11-11", document, null, at),
  );
  vault.setHabitDraft({
    mode: "create",
    id: null,
    name: "Private synthetic habit draft",
  });
  expect(vault.read().entries).toHaveLength(1);
  let revokedDuringClose = false;
  vault.subscribe(() => {
    if (vault.status().phase === "revoked") {
      expect(() => vault.read()).toThrow("journal_stale");
      expect(() => vault.readHabitDraft()).toThrow("journal_stale");
      revokedDuringClose = true;
    }
  });
  store.close();
  expect(revokedDuringClose).toBe(true);
  expect(vault.status()).toMatchObject({
    phase: "revoked",
    dirty: false,
    habitDraftDirty: false,
    pendingRecovery: false,
  });
  expect(() => vault.read()).toThrow("journal_stale");
  expect(() => vault.readHabitDraft()).toThrow("journal_stale");
  expect(vault.canClose()).toBe(true);
});
it("JV-CLOSE-2 never publishes a decrypt result after genuine owner closure", async () => {
  const { store, vault } = await open();
  await vault.create(passphrase);
  await vault.lock();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const real = crypto.subtle.decrypt.bind(crypto.subtle);
  const decrypt = vi
    .spyOn(crypto.subtle, "decrypt")
    .mockImplementationOnce(async (algorithm, key, data) => {
      await gate;
      return real(algorithm, key, data);
    });
  let exposed = false;
  vault.subscribe(() => {
    if (vault.status().phase === "unlocked") exposed = true;
  });
  const opening = vault.unlock(passphrase);
  await vi.waitFor(() => expect(decrypt).toHaveBeenCalled());
  store.close();
  const phaseAtClose = vault.status().phase;
  release();
  await expect(opening).rejects.toThrow("journal_stale");
  expect(phaseAtClose).toBe("revoked");
  expect(exposed).toBe(false);
  expect(() => vault.read()).toThrow("journal_stale");
});
it("JV-CLOSE-3 registers owner-close revocation before initial async read admission", async () => {
  const store = await openCollectionsStore(identity);
  handles.add(store);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const real = store.read.bind(store);
  let reached = false;
  vi.spyOn(store, "read").mockImplementationOnce(async () => {
    const state = await real();
    reached = true;
    await gate;
    return state;
  });
  const opening = openJournalVault(identity, store);
  await vi.waitFor(() => expect(reached).toBe(true));
  store.close();
  release();
  await expect(opening).rejects.toThrow("journal_stale");
});
