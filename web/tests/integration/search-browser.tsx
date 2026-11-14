// Disposable browser-context fixture only. Never imported by production entry.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "../../src/App";
import { applyInitialPreferences } from "../../src/ui/primitives";
import { openNotesStore } from "../../src/data";
import { establish, lock } from "../../src/account/session";
import { loadEngine, DeviceKeys } from "../../src/data/engine";
import {
  newWrappingKey,
  wrappingSecret,
  readRecord,
  mutateRecord,
  type DeviceRecord,
} from "../../src/data/database";
import {
  openCollectionsStore,
  replaceJournal,
} from "../../src/collections/store";
import { createDeck, saveEntry } from "../../src/study/model";
import { createNoteLinkService } from "../../src/links/store";
import {
  createJournalEnvelope,
  emptyJournal,
  journalToday,
  writeJournalEntry,
} from "../../src/collections/journal";
import type { NoteDocument } from "../../src/domain/contracts";
import "../../src/styles/app.css";
import "@fontsource/geist/400.css";
import "@fontsource/geist/500.css";

const identity = {
  accountId: "a1111111-1111-4111-8111-111111111111",
  deviceId: "a2222222-2222-4222-8222-222222222222",
  email: "isolated-search-fixture@example.test",
  deviceState: "trusted" as const,
};
const doc = (text: string): NoteDocument => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});
applyInitialPreferences();
async function start() {
  await loadEngine();
  const fresh = !(await readRecord<DeviceRecord>("devices", identity.email));
  if (fresh) {
    const wrapKey = await newWrappingKey(),
      secret = await wrappingSecret(wrapKey),
      keys = DeviceKeys.create();
    try {
      await mutateRecord<DeviceRecord>("devices", identity.email, () => ({
        ...identity,
        wrapKey,
        sealedKeys: keys.export(secret),
        generation: 0,
        verifiedTrust: true,
      }));
    } finally {
      secret.fill(0);
      keys.free();
    }
  }
  establish(identity);
  const notes = await openNotesStore(identity),
    collections = await openCollectionsStore(identity);
  if (fresh) {
    const note = await notes.create({
      title: "Lisbon packing",
      tags: ["travel"],
      document: doc(
        "Café, Straße and <script>literal text</script>. Budget €20.",
      ),
    });
    for (let i = 1; i <= 61; i++)
      await notes.create({
        title: `Lisbon page ${String(i).padStart(2, "0")}`,
        tags: ["pagination"],
        document: doc(`Travel item ${i}.`),
      });
    await notes.create({
      title: "Other ordinary note",
      tags: [],
      document: doc("Independent writing."),
    });
    const target = await notes.create({
      title: "Connected label",
      tags: [],
      document: doc("Target writing."),
    });
    const emptyTarget = await notes.create({
      title: "",
      tags: [],
      document: doc("Empty title target writing."),
    });
    const links = createNoteLinkService(notes);
    await links.verifyGraph();
    const targetReference = await links.reference(target.id),
      emptyReference = await links.reference(emptyTarget.id);
    await notes.create({
      title: "Reference source",
      tags: [],
      document: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "Current " },
              {
                type: "noteLink",
                attrs: { version: 1, target: targetReference.target },
              },
              { type: "text", text: " label and " },
              { type: "text", text: "Stra", marks: [{ type: "bold" }] },
              { type: "text", text: "ße \u{10400}" },
            ],
          },
        ],
      },
    });
    await notes.create({
      title: "Boundary source",
      tags: [],
      document: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "prefixZX" },
              {
                type: "noteLink",
                attrs: { version: 1, target: emptyReference.target },
              },
              { type: "text", text: "QVsuffix" },
            ],
          },
        ],
      },
    });
    const trash = await notes.create({
      title: "Lisbon trash-only-sentinel",
      tags: [],
      document: doc("trash-only-sentinel"),
    });
    await notes.trash(trash.id, trash.revision);
    const at = new Date("2026-01-01T12:00:00.000Z"),
      current = await collections.read();
    await collections.update(current, (state) => {
      let study = createDeck(state.study, "Lisbon travel", at);
      const base = {
        deckId: study.decks[0]!.id,
        revision: 1,
        tags: ["trip"],
        source: {
          noteId: note.id,
          noteRevision: note.revision,
          quote: "private-source-sentinel",
        },
      };
      study = saveEntry(
        study,
        {
          ...base,
          id: crypto.randomUUID(),
          type: "basic",
          front: "Where is Lisbon?",
          back: "Portugal",
        },
        at,
      );
      study = saveEntry(
        study,
        {
          ...base,
          id: crypto.randomUUID(),
          type: "reversed",
          front: "Lisbon departure",
          back: "Train arrival",
        },
        at,
      );
      study = saveEntry(
        study,
        {
          ...base,
          id: crypto.randomUUID(),
          type: "cloze",
          text: "Lisbon is in {{city}} and costs {{cost}}.",
          blanks: [
            { id: "city", answer: "Portugal" },
            { id: "cost", answer: "€20" },
          ],
        },
        at,
      );
      return {
        ...state,
        study,
        clips: {
          ...state.clips,
          items: [
            {
              id: crypto.randomUUID(),
              revision: 1,
              title: "Lisbon saved archive",
              originalUrl: "https://example.test/lisbon-archive",
              canonicalUrl: "https://example.test/lisbon-archive",
              text: "Archived saved text with Café.",
              createdAt: at.toISOString(),
              updatedAt: at.toISOString(),
              readAt: null,
              readLater: true,
              archivedAt: at.toISOString(),
            },
            {
              id: crypto.randomUUID(),
              revision: 1,
              title: "Lisbon link only",
              originalUrl: "https://example.test/lisbon-link",
              canonicalUrl: "https://example.test/lisbon-link",
              text: null,
              createdAt: at.toISOString(),
              updatedAt: at.toISOString(),
              readAt: null,
              readLater: false,
              archivedAt: null,
            },
          ],
        },
      };
    });
    const latest = await collections.read();
    const journal = writeJournalEntry(
      emptyJournal(),
      journalToday(),
      doc("Lisbon private-journal-sentinel"),
      null,
      new Date(),
    );
    // Synthetic-only passphrase exists solely in this disposable test entry.
    const sealed = await createJournalEnvelope(
      "Synthetic Journal fixture phrase 2026",
      journal,
      { accountId: identity.accountId, epoch: latest.epoch },
      () => {},
    );
    await replaceJournal(collections, latest, sealed.envelope);
  }
  Object.assign(window, {
    __searchFixture: {
      metadata: async () => {
        const state = await collections.read();
        return {
          accountId: identity.accountId,
          collectionsEpoch: state.epoch,
          notes: (await notes.list()).map(
            ({ id, title, revision, trashedAt }) => ({
              id,
              title,
              revision,
              trashedAt,
            }),
          ),
          clips: state.clips.items.map(
            ({ id, title, revision, archivedAt, readAt, readLater }) => ({
              id,
              title,
              revision,
              archivedAt,
              readAt,
              readLater,
            }),
          ),
          cards: state.study.cards.map(({ id, entryId, key, revision }) => ({
            id,
            entryId,
            key,
            revision,
          })),
          entries: state.study.entries.map(
            ({ id, type, deckId, revision }) => ({
              id,
              type,
              deckId,
              revision,
            }),
          ),
          eventCount: state.study.events.length,
        };
      },
      renameNote: async (id: string, title: string) => {
        const note = await notes.get(id);
        if (!note) throw new Error("Fixture note unavailable");
        await notes.update(id, { title }, note.revision);
      },
      invalidateWrappingProof: async () => {
        // Unnotified authority failure in this disposable profile only. Keep
        // the sealed bytes unchanged; expose neither the old nor new key.
        const replacement = await newWrappingKey();
        await mutateRecord<DeviceRecord>(
          "devices",
          identity.email,
          (current) => {
            if (!current) throw new Error("Fixture device record unavailable");
            return { ...current, wrapKey: replacement };
          },
        );
      },
      seedLarge: async (count = 3) => {
        if (!Number.isInteger(count) || count < 1 || count > 3)
          throw new Error("Choose one to three real large fixture notes.");
        for (let i = 0; i < count; i++) {
          const title =
            i === 0 ? "Large bounded corpus" : `Large bounded corpus ${i + 1}`;
          if ((await notes.list()).some((note) => note.title === title))
            continue;
          await notes.create({
            title,
            tags: [],
            document: {
              type: "doc",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "a ".repeat(475000) }],
                },
                {
                  type: "paragraph",
                  content: [
                    {
                      type: "text",
                      text: "b ".repeat(475000) + " bounded-hit",
                    },
                  ],
                },
              ],
            },
          });
        }
      },
      erase: () => notes.erase(),
      lock: () => lock(false),
    },
  });
  performance.mark("search-fixture-app-render");
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
void start().catch((error) => {
  document.getElementById("root")!.dataset.fixtureFailed = "true";
  document.getElementById("root")!.textContent =
    error instanceof Error ? error.message : "Search fixture failed";
});
