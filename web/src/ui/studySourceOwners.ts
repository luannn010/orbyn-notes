import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import type { AccountSession } from "../domain/contracts";
import type { NotesLibraryStore } from "../library/contracts";
import type { CollectionsStore } from "../collections/contracts";
import type { StudySourceService } from "../study/sourceContracts";
import { trackOperation } from "../desktop/closeGuard";
/** Genuine account owners, shared by Notes and the collections host. Fixtures may omit the owner. */
export function useStudySourceOwners(
  owner: NotesLibraryStore | undefined,
  session: AccountSession,
  onInvalidate: () => void,
) {
  const [collections, setCollections] = useState<CollectionsStore | null>(null),
    [service, setService] = useState<StudySourceService | null>(null),
    [bootSettled, setBootSettled] = useState(false),
    [error, setError] = useState(""),
    [attempt, setAttempt] = useState(0);
  const invalidate = useRef(onInvalidate);
  const bootOperations = useRef(0),
    mounted = useRef(false);
  invalidate.current = onInvalidate;
  useEffect(() => {
    if (!owner) return;
    mounted.current = true;
    bootOperations.current++;
    let active = true,
      openedCollections: CollectionsStore | undefined,
      openedService: StudySourceService | undefined,
      stop: (() => void) | undefined;
    setCollections(null);
    setBootSettled(false);
    setService(null);
    setError("");
    void trackOperation(async () => {
      const [{ openCollectionsStore }, { createStudySourceService }] =
        await Promise.all([
          import("../collections/store"),
          import("../study/sourceStore"),
        ]);
      const collections = await openCollectionsStore(session);
      openedCollections = collections;
      if (!active) {
        collections.close();
        return;
      }
      const service = createStudySourceService(owner, collections);
      openedService = service;
      stop = service.onInvalidate(() => {
        if (active) flushSync(() => invalidate.current());
      });
      if (active) {
        setCollections(collections);
        setService(service);
      } else {
        stop();
        service.close();
        collections.close();
      }
    })
      .catch(() => {
        openedService?.close();
        openedCollections?.close();
        if (active)
          setError(
            "Study links couldn’t open. Your saved data was not changed.",
          );
      })
      .finally(() => {
        bootOperations.current--;
        if (mounted.current && bootOperations.current === 0)
          setBootSettled(true);
      });
    return () => {
      mounted.current = false;
      active = false;
      stop?.();
      openedService?.close();
      openedCollections?.close();
    };
  }, [owner, session.accountId, session.deviceId, session.email, attempt]);
  return {
    collections,
    service,
    bootSettled,
    error,
    retry: () => setAttempt((value) => value + 1),
  };
}
