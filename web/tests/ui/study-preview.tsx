import { createRoot } from "react-dom/client";
import { StudyView } from "../../src/ui/StudyView";
import type {
  CollectionsState,
  CollectionsStore,
} from "../../src/collections/contracts";
import { CollectionsRevisionConflictError } from "../../src/collections/contracts";
import {
  emptyStudy,
  validateCollections,
} from "../../src/collections/validation";
import "../../src/styles/app.css";

// Test-only memory store. Production CollectionsHost always opens the real sealed store.
let state: CollectionsState = {
  version: 3,
  epoch: crypto.randomUUID(),
  revision: 0,
  study: emptyStudy(Intl.DateTimeFormat().resolvedOptions().timeZone),
  journal: null,
  clips: { items: [], receipts: [] },
};
const listeners = new Set<() => void>();
const store: CollectionsStore = {
  read: async () => structuredClone(state),
  update: async (expected, change) => {
    if (expected.epoch !== state.epoch || expected.revision !== state.revision)
      throw new CollectionsRevisionConflictError(structuredClone(state));
    state = validateCollections({
      ...change(structuredClone(state)),
      revision: state.revision + 1,
    });
    listeners.forEach((listener) => listener());
    return structuredClone(state);
  },
  subscribe: (listener) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  persistence: () => ({ status: "ready" }),
  close: () => listeners.clear(),
};
createRoot(document.getElementById("root")!).render(
  <StudyView store={store} />,
);
