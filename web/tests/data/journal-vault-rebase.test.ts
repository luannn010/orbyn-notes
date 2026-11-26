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
import { IDBFactory } from "fake-indexeddb";
import { initSync, DeviceKeys } from "../../src/generated/wasm/orbyn_wasm.js";
import {
  openCollectionsStore,
  replaceJournal,
} from "../../src/collections/store";
import { openJournalVault } from "../../src/collections/journalVault";
import { writeJournalEntry } from "../../src/collections/journal";
import { createClipsStore } from "../../src/clips/store";
import { establish, lock as lockAccount } from "../../src/account/session";
import {
  newWrappingKey,
  wrappingSecret,
  mutateRecord,
} from "../../src/data/database";
import type { DeviceRecord } from "../../src/data/database";

// The hook runs between sealing and the freshness re-read of the save loop, so the
// Collections write below always lands inside the window the save must rebase over.
const seals = vi.hoisted(() => ({
  afterSeal: null as (() => Promise<void>) | null,
}));

vi.mock("../../src/collections/journal", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/collections/journal")>();
  return {
    ...actual,
    sealJournalData: async (
      ...args: Parameters<typeof actual.sealJournalData>
    ) => {
      const envelope = await actual.sealJournalData(...args);
      const hook = seals.afterSeal;
      seals.afterSeal = null;
      if (hook) await hook();
      return envelope;
    },
  };
});

const identity = {
  accountId: "11111111-1111-4111-8111-111111111111",
  deviceId: "22222222-2222-4222-8222-222222222222",
  email: "vault-rebase@example.test",
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
      content: [{ type: "text", text: "Private journal draft" }],
    },
  ],
};
const otherDocument = {
  type: "doc" as const,
  content: [
    {
      type: "paragraph",
      content: [{ type: "text", text: "Another window won" }],
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

// A real Clip save through the shared Collections store, from a second window:
// the revision moves while this window's Journal envelope is unchanged.
async function saveClipFromAnotherWindow() {
  const collections = await openCollectionsStore(identity);
  handles.add(collections);
  const clips = createClipsStore(collections);
  handles.add(clips);
  const state = await collections.read();
  await clips.commit(
    await clips.prepare(
      { epoch: state.epoch, revision: state.revision },
      {
        kind: "create",
        url: "https://example.test/unrelated-clip",
        title: "Unrelated Clip",
        text: "Saved while the Journal was sealing",
        readLater: false,
        allowDuplicate: false,
      },
    ),
  );
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
  seals.afterSeal = null;
  for (const handle of handles) handle.close();
  handles.clear();
  vi.restoreAllMocks();
  lockAccount();
  vi.unstubAllGlobals();
});

describe("Journal save rebase", () => {
  it("rebases the save when an unrelated Clip save commits during sealing", async () => {
    const { store, vault } = await open();
    await vault.create(passphrase);
    const before = await store.read();
    // The second window's change notification is not delivered to this window
    // before the save commits, so only the save loop can observe the new revision.
    vi.spyOn(BroadcastChannel.prototype, "postMessage").mockImplementation(
      () => {},
    );
    let hookRan = false;
    seals.afterSeal = async () => {
      hookRan = true;
      await saveClipFromAnotherWindow();
    };
    await vault.update((data) =>
      writeJournalEntry(data, "2026-11-11", document, null, at),
    );
    expect(hookRan).toBe(true);
    expect(seals.afterSeal).toBeNull();
    const after = await store.read();
    expect(after.revision).toBe(before.revision + 2);
    expect(after.clips.items).toHaveLength(1);
    expect(after.journal).not.toEqual(before.journal);
    expect(vault.status()).toMatchObject({
      phase: "unlocked",
      dirty: false,
      conflict: false,
      error: null,
    });
    expect(vault.read().entries).toHaveLength(1);
  });

  it("still conflicts when another window changes the Journal envelope during sealing", async () => {
    const { store, vault } = await open();
    await vault.create(passphrase);
    const before = await store.read();
    const context = { accountId: identity.accountId, epoch: before.epoch };
    const actual = await vi.importActual<
      typeof import("../../src/collections/journal")
    >("../../src/collections/journal");
    const opened = await actual.unlockJournalEnvelope(
      before.journal!,
      passphrase,
      context,
      () => {},
    );
    const foreignEnvelope = await actual.sealJournalData(
      opened.key,
      before.journal!.kdf,
      actual.writeJournalEntry(
        actual.emptyJournal(),
        "2026-11-11",
        otherDocument,
        null,
        at,
      ),
      context,
      () => {},
    );
    vi.spyOn(BroadcastChannel.prototype, "postMessage").mockImplementation(
      () => {},
    );
    seals.afterSeal = async () => {
      const collections = await openCollectionsStore(identity);
      handles.add(collections);
      const state = await collections.read();
      await replaceJournal(collections, state, foreignEnvelope);
    };
    await expect(
      vault.update((data) =>
        writeJournalEntry(data, "2026-11-11", document, null, at),
      ),
    ).rejects.toThrow("journal_conflict");
    expect(seals.afterSeal).toBeNull();
    expect(vault.status()).toMatchObject({
      conflict: true,
      dirty: true,
      error:
        "journal_conflict: Journal changed in another window. Keep your draft or discard it explicitly before reloading.",
    });
    // The other writer's envelope is kept; this window's draft stays in memory.
    expect((await store.read()).journal).toEqual(foreignEnvelope);
    expect(vault.read().entries).toHaveLength(1);
    expect(vault.read().entries[0]!.date).toBe("2026-11-11");
    expect(vault.read().entries[0]!.document).toEqual(document);
  });
});
