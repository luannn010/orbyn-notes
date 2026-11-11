import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  IncomingNoteLinkController,
  formatWebNoteLink,
  parseNoteLinkHash,
} from "./entry";
import type { NoteLinkCopyFormatter, NoteLinkNavigator } from "./navigation";
import { nativeNoteLinkIngress } from "../desktop/noteLinks";

// A React StrictMode setup/cleanup shares its controller. A genuinely different
// consumer must retire the old broker intent before it can receive anything.
let nativeConsumer: symbol | null = null;
let reportNativeFailure: () => void = () => {};

function clearNoteHash() {
  if (parseNoteLinkHash(window.location.hash).kind === "unrelated") return;
  // Keep the app's path/query intact; clearing an intent is not a navigation.
  window.history.replaceState(
    window.history.state,
    "",
    window.location.pathname + window.location.search,
  );
}

export function useIncomingNoteLink(owner: object | null, desktop: boolean) {
  const [transportError, setTransportError] = useState(false);
  const consumer = useRef(Symbol("native-note-entry"));
  const reconnect = useRef<(() => Promise<void>) | null>(null);
  const reconnecting = useRef(false);
  const controllerRef = useRef<IncomingNoteLinkController | null>(null);
  if (!controllerRef.current)
    controllerRef.current = new IncomingNoteLinkController(() => {
      clearNoteHash();
      if (desktop)
        void nativeNoteLinkIngress.retire().catch(() => reportNativeFailure());
    });
  const controller = controllerRef.current;
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.state,
    () => null,
  );
  const hasPending = useSyncExternalStore(
    controller.subscribe,
    controller.hasPending,
    () => false,
  );
  useLayoutEffect(() => {
    controller.bind(owner);
  }, [controller, owner]);
  useEffect(() => {
    // Web hash handling is not a claim of native protocol registration.
    if (desktop) return;
    const receive = () => controller.receive(window.location.hash);
    receive();
    window.addEventListener("hashchange", receive);
    return () => {
      window.removeEventListener("hashchange", receive);
    };
  }, [controller, desktop]);
  useEffect(() => {
    if (!desktop) return;
    let active = true;
    let connection = 0;
    const identity = consumer.current;
    const report = () => {
      if (active && nativeConsumer === identity) setTransportError(true);
    };
    reportNativeFailure = report;
    if (nativeConsumer && nativeConsumer !== identity)
      void nativeNoteLinkIngress.retire().catch(() => reportNativeFailure());
    nativeConsumer = identity;
    const start = async () => {
      const ticket = ++connection;
      try {
        await nativeNoteLinkIngress.start(
          (target) => {
            if (!active || nativeConsumer !== identity) return false;
            setTransportError(false);
            controller.receiveTarget(target);
            return true;
          },
          () => {
            if (active && nativeConsumer === identity) {
              setTransportError(false);
              controller.receiveInvalid();
            }
          },
          report,
        );
      } catch (error) {
        if (active && ticket === connection) throw error;
      }
    };
    const restart = async () => {
      // Reconnect deliberately retires old pending identity. The notice tells
      // the user to open the link again; this never replays a refused target.
      await nativeNoteLinkIngress.retire();
      if (!active || nativeConsumer !== identity) return;
      controller.dismiss();
      await start();
      if (active) setTransportError(false);
    };
    reconnect.current = restart;
    void start().catch(report);
    return () => {
      active = false;
      connection++;
      if (reconnect.current === restart) reconnect.current = null;
      if (reportNativeFailure === report) reportNativeFailure = () => {};
      // The singleton listener/watermark lives for the app lifetime. Its old
      // callback refuses handoff; a new consumer retires pending state above.
    };
  }, [controller, desktop]);
  const register = useCallback(
    (navigator: NoteLinkNavigator | null) => {
      if (owner) controller.register(owner, navigator);
    },
    [controller, owner],
  );
  const format = useCallback<NoteLinkCopyFormatter>(
    (target) => formatWebNoteLink(target, window.location.href),
    [],
  );
  const revoke = useCallback(() => controller.revoke(), [controller]);
  const retry = useCallback(() => {
    if (!transportError) {
      controller.retry();
      return;
    }
    if (reconnecting.current || !reconnect.current) return;
    reconnecting.current = true;
    void reconnect
      .current()
      .catch(() => setTransportError(true))
      .finally(() => {
        reconnecting.current = false;
      });
  }, [controller, transportError]);
  const dismiss = useCallback(() => {
    setTransportError(false);
    controller.dismiss();
    clearNoteHash();
  }, [controller]);
  return {
    hasPending,
    state: transportError ? ("service-error" as const) : state,
    register,
    format: desktop ? undefined : format,
    revoke,
    retry,
    dismiss,
  };
}
