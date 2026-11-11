// Disposable integration fixture; never imported by the production entry.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "../../src/App";
import { applyInitialPreferences } from "../../src/ui/primitives";
import { establish, lock } from "../../src/account/session";
import { openNotesStore } from "../../src/data";
import { loadEngine, DeviceKeys } from "../../src/data/engine";
import {
  newWrappingKey,
  wrappingSecret,
  readRecord,
  mutateRecord,
  type DeviceRecord,
} from "../../src/data/database";
import { openCollectionsStore } from "../../src/collections/store";
import type { StudyPreferences } from "../../src/collections/contracts";
import { createDeck, saveEntry } from "../../src/study/model";
import "../../src/styles/app.css";
import "@fontsource/geist/400.css";
import "@fontsource/geist/500.css";

const identity = {
  accountId: "b1111111-1111-4111-8111-111111111111",
  deviceId: "b2222222-2222-4222-8222-222222222222",
  email: "isolated-study-settings@example.test",
  deviceState: "trusted" as const,
};
type Editable = Pick<
  StudyPreferences,
  | "newPerDay"
  | "reviewsPerDay"
  | "dayStartHour"
  | "showNextReview"
  | "showStreak"
>;
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
    await notes.create({
      title: "Study settings fixture note",
      tags: [],
      document: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: "A real encrypted note keeps optional setup from taking over.",
              },
            ],
          },
        ],
      },
    });
    const current = await collections.read(),
      at = new Date("2026-01-01T12:00:00.000Z");
    await collections.update(current, (state) => {
      let study = createDeck(state.study, "Settings continuity", at);
      for (let i = 1; i <= 4; i++) {
        study = saveEntry(
          study,
          {
            id: crypto.randomUUID(),
            deckId: study.decks[0]!.id,
            revision: 1,
            tags: [],
            source: null,
            type: "basic",
            front: `Settings question ${i}`,
            back: `Settings answer ${i}`,
          },
          at,
        );
      }
      return { ...state, study };
    });
  }
  Object.assign(window, {
    __studySettingsFixture: {
      metadata: async () => {
        const state = await collections.read();
        return {
          epoch: state.epoch,
          revision: state.revision,
          preferences: state.study.preferences,
          decks: state.study.decks,
          cards: state.study.cards,
          events: state.study.events,
        };
      },
      setPreferences: async (patch: Partial<Editable>) => {
        const allowed = new Set([
          "newPerDay",
          "reviewsPerDay",
          "dayStartHour",
          "showNextReview",
          "showStreak",
        ]);
        if (Object.keys(patch).some((key) => !allowed.has(key)))
          throw new Error(
            "Only the five editable preference keys are admitted by this fixture.",
          );
        const state = await collections.read();
        await collections.update(state, (current) => ({
          ...current,
          study: {
            ...current.study,
            preferences: { ...current.study.preferences, ...patch },
          },
        }));
      },
      erase: () => notes.erase(),
      lock: () => lock(false),
    },
  });
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
void start().catch((error) => {
  const root = document.getElementById("root")!;
  root.dataset.fixtureFailed = "true";
  root.textContent =
    error instanceof Error ? error.message : "Study settings fixture failed";
});
