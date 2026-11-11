// Test-only direct production component with genuine account/store authority.
// Gates delay actual read acknowledgements or admission to the real writer;
// they never fabricate state, authority, commits or successful grades.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { StudyView } from "../../src/ui/StudyView";
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
import {
  openCollectionsStore,
  onCollectionsEpochChange,
} from "../../src/collections/store";
import type { CollectionsStore } from "../../src/collections/contracts";
import { createDeck, saveEntry } from "../../src/study/model";
import "../../src/styles/app.css";
import "@fontsource/geist/400.css";
import "@fontsource/geist/500.css";

const identity = {
  accountId: "c1111111-1111-4111-8111-111111111111",
  deviceId: "c2222222-2222-4222-8222-222222222222",
  email: "isolated-study-motion@example.test",
  deviceState: "trusted" as const,
};
type Gate = {
  claimed: boolean;
  reached: boolean;
  released: boolean;
  all: boolean;
  wait: Promise<void>;
  release: () => void;
};
function gate(all = false): Gate {
  let resolveWait!: () => void;
  const wait = new Promise<void>((resolve) => {
    resolveWait = resolve;
  });
  const value: Gate = {
    claimed: false,
    reached: false,
    released: false,
    all,
    wait,
    release: () => {
      value.released = true;
      resolveWait();
    },
  };
  return value;
}
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
  let notes = await openNotesStore(identity),
    current = await openCollectionsStore(identity);
  if (fresh) {
    await notes.create({
      title: "Motion fixture note",
      tags: [],
      document: { type: "doc", content: [{ type: "paragraph" }] },
    });
    const initial = await current.read(),
      at = new Date("2026-01-01T12:00:00Z");
    await current.update(initial, (state) => {
      let study = createDeck(state.study, "Motion continuity", at);
      for (let i = 1; i <= 4; i++)
        study = saveEntry(
          study,
          {
            id: crypto.randomUUID(),
            deckId: study.decks[0]!.id,
            revision: 1,
            tags: [],
            source: null,
            type: "basic",
            front: `Motion question ${i}`,
            back: `Motion answer ${i}`,
          },
          at,
        );
      return { ...state, study };
    });
  }
  let readGate: Gate | null = new URL(location.href).searchParams.has(
      "holdRead",
    )
      ? gate(true)
      : null,
    commitGate: Gate | null = null,
    actualRead: CollectionsStore["read"],
    covered = false;
  const epochSamples: boolean[] = [];
  function wrap(store: CollectionsStore) {
    const read = store.read.bind(store),
      update = store.update.bind(store);
    actualRead = read;
    store.read = async () => {
      const held =
        readGate && !readGate.released && (readGate.all || !readGate.claimed)
          ? readGate
          : null;
      if (held) held.claimed = true;
      const result = await read();
      if (held) {
        held.reached = true;
        await held.wait;
      }
      return result;
    };
    store.update = async (expected, change) => {
      const held =
        commitGate && !commitGate.released && !commitGate.claimed
          ? commitGate
          : null;
      if (held) {
        held.claimed = true;
        held.reached = true;
        await held.wait;
      }
      return update(expected, change);
    };
    return store;
  }
  current = wrap(current);
  const root = createRoot(document.getElementById("root")!);
  const noCardDom = () => document.querySelector(".study-flash") === null;
  function render() {
    root.render(
      <StrictMode>
        <StudyView
          store={current}
          accountId={identity.accountId}
          covered={covered}
          onReopen={() => void reopen().catch(fail)}
        />
      </StrictMode>,
    );
  }
  async function reopen() {
    const next = await openCollectionsStore(identity),
      nextNotes = await openNotesStore(identity);
    current.close();
    notes.close();
    current = wrap(next);
    notes = nextNotes;
    render();
  }
  Object.assign(window, {
    __studyMotionFixture: {
      metadata: async () => {
        const state = await actualRead();
        return {
          epoch: state.epoch,
          revision: state.revision,
          study: state.study,
        };
      },
      holdNextRead: () => {
        if (readGate && !readGate.released)
          throw Error("A read gate is already pending.");
        readGate = gate();
      },
      releaseRead: () => readGate?.release(),
      holdNextCommit: () => {
        if (commitGate && !commitGate.released)
          throw Error("A commit gate is already pending.");
        commitGate = gate();
      },
      releaseCommit: () => commitGate?.release(),
      gates: () => ({
        readReached: readGate?.reached ?? false,
        commitReached: commitGate?.reached ?? false,
      }),
      closeAndInspect: () => {
        current.close();
        return { noCardDom: noCardDom() };
      },
      lockAndInspect: () => {
        lock(false);
        return { noCardDom: noCardDom() };
      },
      reauthenticateAndInspect: () => {
        establish(identity);
        return { noCardDom: noCardDom() };
      },
      watchEpoch: () =>
        onCollectionsEpochChange(current, () => epochSamples.push(noCardDom())),
      eraseAndObserve: async () => {
        await notes.erase();
        await actualRead();
        return { noCardDom: noCardDom(), epochSamples: [...epochSamples] };
      },
      setCovered: (value: boolean) => {
        covered = value;
        render();
      },
      toggleStreak: async () => {
        const state = await actualRead();
        await current.update(state, (latest) => ({
          ...latest,
          study: {
            ...latest.study,
            preferences: {
              ...latest.study.preferences,
              showStreak: !latest.study.preferences.showStreak,
            },
          },
        }));
      },
      editEntry: async (id: string, front: string) => {
        const state = await actualRead(),
          entry = state.study.entries.find((item) => item.id === id);
        if (!entry || entry.type !== "basic")
          throw Error("Choose a genuine basic fixture entry.");
        await current.update(state, (latest) => ({
          ...latest,
          study: saveEntry(
            latest.study,
            { ...entry, revision: entry.revision + 1, front },
            new Date(),
          ),
        }));
      },
      reopen,
    },
  });
  render();
}
function fail(error: unknown) {
  const root = document.getElementById("root")!;
  root.dataset.fixtureFailed = "true";
  root.textContent =
    error instanceof Error ? error.message : "Motion fixture failed";
}
void start().catch(fail);
