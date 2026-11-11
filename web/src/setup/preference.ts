export const SETUP_PREFERENCE_KEY = "notes.setup";
type HintStorage = Pick<Storage, "getItem" | "setItem">;
export interface SetupPreference {
  isDismissed(): boolean;
  dismiss(): Readonly<{ persisted: boolean }>;
  subscribe(listener: () => void): () => void;
}

/** Optional profile introduction only: never account or library state. */
export function createSetupPreference(
  storage: () => HintStorage | null,
  events?: EventTarget,
): SetupPreference {
  let dismissedHere = false;
  const listeners = new Set<() => void>();
  function notify() {
    for (const listener of listeners) {
      try {
        listener();
      } catch {
        /* One observer cannot block completion. */
      }
    }
  }
  const changed = (event: Event) => {
    const key = (event as StorageEvent).key;
    if (key === SETUP_PREFERENCE_KEY || key === null) notify();
  };
  return {
    isDismissed() {
      if (dismissedHere) return true;
      try {
        const raw = storage()?.getItem(SETUP_PREFERENCE_KEY);
        if (!raw || raw.length > 256) return false;
        const value: unknown = JSON.parse(raw);
        if (!value || typeof value !== "object" || Array.isArray(value))
          return false;
        const hint = value as Record<string, unknown>;
        dismissedHere =
          Object.keys(hint).length === 2 &&
          Object.hasOwn(hint, "version") &&
          Object.hasOwn(hint, "dismissed") &&
          hint.version === 1 &&
          hint.dismissed === true;
      } catch {
        /* Missing/denied preferences never prevent browsing. */
      }
      return dismissedHere;
    },
    dismiss() {
      dismissedHere = true;
      let persisted = false;
      try {
        const current = storage();
        if (current) {
          current.setItem(
            SETUP_PREFERENCE_KEY,
            '{"version":1,"dismissed":true}',
          );
          persisted = true;
        }
      } catch {
        /* The context latch prevents repeated optional takeover. */
      }
      notify();
      return Object.freeze({ persisted });
    },
    subscribe(listener) {
      if (listeners.size === 0) events?.addEventListener("storage", changed);
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0)
          events?.removeEventListener("storage", changed);
      };
    },
  };
}

export const profileSetupPreference = createSetupPreference(
  () => (typeof localStorage === "undefined" ? null : localStorage),
  typeof window === "undefined" ? undefined : window,
);
