import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { flushSync } from "react-dom";
import type { CollectionsStore } from "../collections/contracts";
import type { NotesLibraryStore } from "../library/contracts";
import type { SearchInvalidation } from "../search/contracts";
import type { LocalSearchService, SearchState } from "../search/results";
const idle: SearchState = Object.freeze({ status: "idle", raw: "" });
const subscribeEmpty = () => () => {};
const readEmpty = () => idle;

/** One genuine account-lifetime facade; no corpus admission or fixture mode. */
export function useLocalSearchOwner(
  owner: NotesLibraryStore | undefined,
  collections: CollectionsStore | null,
  onInvalidate: (reason: SearchInvalidation) => void,
) {
  const [service, setService] = useState<LocalSearchService | null>(null);
  const [error, setError] = useState(false),
    [attempt, setAttempt] = useState(0);
  const invalidation = useRef(onInvalidate);
  invalidation.current = onInvalidate;
  useEffect(() => {
    setService(null);
    setError(false);
    if (!owner || !collections) return;
    let active = true,
      opened: LocalSearchService | undefined,
      stop: (() => void) | undefined;
    void import("../search/service")
      .then(({ createLocalSearchService }) => {
        if (!active) return;
        opened = createLocalSearchService(owner, collections);
        stop = opened.onInvalidate((reason) => {
          if (active) flushSync(() => invalidation.current(reason));
        });
        setService(opened);
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
      stop?.();
      opened?.close();
    };
  }, [owner, collections, attempt]);
  const state = useSyncExternalStore(
    service?.subscribe ?? subscribeEmpty,
    service?.getSnapshot ?? readEmpty,
    readEmpty,
  );
  return {
    service,
    state,
    error,
    retry: () => setAttempt((value) => value + 1),
  };
}
