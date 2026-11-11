import { useLayoutEffect, useRef, useState } from "react";
import { registerCloseGuard, trackOperation } from "../desktop/closeGuard";
import type { LibraryMutationResult } from "../library/contracts";
import { message } from "./model";

type Intent = {
  id: string;
  effect: (id: string) => Promise<LibraryMutationResult>;
  done: (value: LibraryMutationResult) => void;
};
/** A failed action retains its original arguments and receipt ID. Reload never rebases it. */
export function useLibraryAction(scope?: string) {
  const alive = useRef(false);
  const generation = useRef(0);
  const intent = useRef<Intent | null>(null);
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [reloaded, setReloaded] = useState(false);
  useLayoutEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      generation.current++;
    };
  }, []);
  useLayoutEffect(() => {
    generation.current++;
    intent.current = null;
    pending.current = false;
    setBusy(false);
    setError("");
    setConflict(false);
    setReloaded(false);
  }, [scope]);
  useLayoutEffect(
    () => registerCloseGuard(() => !pending.current && !intent.current),
    [],
  );
  useLayoutEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {
      if (intent.current) event.preventDefault();
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, []);
  async function execute(value: Intent) {
    if (pending.current) return;
    const invocation = generation.current;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await trackOperation(() => value.effect(value.id));
      if (!alive.current || invocation !== generation.current) return;
      intent.current = null;
      value.done(result);
    } catch (failure) {
      if (!alive.current || invocation !== generation.current) return;
      const code =
        failure && typeof failure === "object" && "code" in failure
          ? String(failure.code)
          : "";
      setConflict(
        code === "library_conflict" ||
          code === "library_epoch_changed" ||
          code === "conflict" ||
          code === "revision_conflict",
      );
      setError(message(failure));
      setReloaded(false);
    } finally {
      if (alive.current && invocation === generation.current) {
        pending.current = false;
        setBusy(false);
      }
    }
  }
  return {
    busy,
    error,
    conflict,
    reloaded,
    start(effect: Intent["effect"], done: Intent["done"]) {
      if (intent.current || pending.current) return;
      const value = { id: crypto.randomUUID(), effect, done };
      intent.current = value;
      setConflict(false);
      setReloaded(false);
      void execute(value);
    },
    async reload(read: () => Promise<unknown>) {
      const invocation = generation.current,
        action = intent.current;
      try {
        await read();
        if (
          alive.current &&
          invocation === generation.current &&
          action === intent.current
        )
          setReloaded(true);
      } catch (e) {
        if (
          alive.current &&
          invocation === generation.current &&
          action === intent.current
        )
          setError(message(e));
      }
    },
    retry() {
      if (intent.current && reloaded && !conflict) void execute(intent.current);
    },
    dismiss() {
      if (!pending.current) {
        intent.current = null;
        setError("");
        setConflict(false);
      }
    },
  };
}
export function LibraryActionFeedback({
  action,
  reload,
}: {
  action: ReturnType<typeof useLibraryAction>;
  reload: () => Promise<unknown>;
}) {
  if (!action.error) return null;
  return (
    <div className="banner error" role="alert">
      <p>{action.error}</p>
      <p>
        {action.conflict
          ? "The saved library changed. Reload, then review your action before submitting it again."
          : "The result could not be confirmed. Reload before retrying the same action."}
      </p>
      <button disabled={action.busy} onClick={() => void action.reload(reload)}>
        Reload saved library
      </button>
      {!action.conflict && (
        <button
          disabled={!action.reloaded || action.busy}
          onClick={action.retry}
        >
          Retry same action
        </button>
      )}
      <button disabled={action.busy} onClick={action.dismiss}>
        Keep draft and clear action
      </button>
    </div>
  );
}
