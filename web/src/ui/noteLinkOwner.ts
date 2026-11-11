import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import type { NotesLibraryStore } from "../library/contracts";
import type { NoteLinkService } from "../links/contracts";
export function useNoteLinkOwner(
  owner: NotesLibraryStore | undefined,
  onInvalidate: (reason: "epoch" | "closed") => void,
) {
  const [service, setService] = useState<NoteLinkService | null>(null),
    [bootSettled, setBootSettled] = useState(false),
    [error, setError] = useState(""),
    [attempt, setAttempt] = useState(0);
  const invalid = useRef(onInvalidate);
  invalid.current = onInvalidate;
  useEffect(() => {
    if (!owner) return;
    let active = true,
      opened: NoteLinkService | undefined,
      stop: (() => void) | undefined;
    setService(null);
    setBootSettled(false);
    setError("");
    void import("../links/store")
      .then(({ createNoteLinkService }) => {
        if (!active) return;
        opened = createNoteLinkService(owner);
        stop = opened.onInvalidate((reason) => {
          if (active)
            flushSync(() => {
              setService(null);
              invalid.current(reason);
              if (reason === "epoch") setAttempt((value) => value + 1);
            });
        });
        setService(opened);
        // One bounded startup allowance; paused work resumes only by deliberate action.
        void opened
          .verifyGraph()
          .catch(() => {})
          .finally(() => {
            if (active) setBootSettled(true);
          });
      })
      .catch(() => {
        if (active)
          setError("Note links couldn’t open. Your notes were not changed.");
        if (active) setBootSettled(true);
      });
    return () => {
      active = false;
      stop?.();
      opened?.close();
    };
  }, [owner, attempt]);
  return {
    service,
    error,
    bootSettled,
    retry: () => setAttempt((value) => value + 1),
  };
}
