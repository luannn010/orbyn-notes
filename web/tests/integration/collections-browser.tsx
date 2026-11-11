// Test-only entry. Never imported by the production application.
import { createRoot } from "react-dom/client";
import { StudyView } from "../../src/ui/StudyView";
import { JournalView } from "../../src/ui/JournalView";
import { openJournalVault } from "../../src/collections/journalVault";
import { applyInitialPreferences } from "../../src/ui/primitives";
import { openCollectionsStore } from "../../src/collections/store";
import { openNotesStore } from "../../src/data";
import { establish } from "../../src/account/session";
import { loadEngine, DeviceKeys } from "../../src/data/engine";
import {
  newWrappingKey,
  wrappingSecret,
  readRecord,
  mutateRecord,
} from "../../src/data/database";
import type { DeviceRecord } from "../../src/data/database";
import "../../src/styles/app.css";
import "@fontsource/geist/400.css";
import "@fontsource/geist/500.css";

const identity = {
  accountId: "11111111-1111-4111-8111-111111111111",
  deviceId: "22222222-2222-4222-8222-222222222222",
  email: "isolated-collections-fixture@example.test",
  deviceState: "trusted" as const,
};
applyInitialPreferences();
async function start() {
  await loadEngine();
  if (!(await readRecord<DeviceRecord>("devices", identity.email))) {
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
  }
  establish(identity);
  const store = await openCollectionsStore(identity);
  const notes = await openNotesStore(identity);
  Object.assign(window, {
    __collectionsFixture: {
      read: () => store.read(),
      close: () => store.close(),
      erase: () => notes.erase(),
    },
  });
  if (new URLSearchParams(location.search).get("view") === "journal") {
    const vault = await openJournalVault(identity, store);
    Object.assign(window, {
      __journalFixture: {
        status: () => vault.status(),
        lock: () => vault.lock(),
        setAway: (away: boolean) => vault.setAway(away),
      },
    });
    createRoot(document.getElementById("root")!).render(
      <JournalView vault={vault} />,
    );
  } else
    createRoot(document.getElementById("root")!).render(
      <StudyView store={store} />,
    );
}
void start().catch((error) => {
  document.getElementById("root")!.textContent =
    error instanceof Error ? error.message : "Fixture failed";
});
