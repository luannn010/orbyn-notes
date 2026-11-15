import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { checkClose, lockClosing } from "./closeGuard";
import { freezeWindow } from "./freeze";
import { isDesktop } from "./window";
export const isQuickWindow = () =>
  isDesktop() && new URLSearchParams(location.search).get("capture") === "1";
export const openQuickNote = () => invoke<void>("capture_open");
export const showNotes = () => invoke<void>("capture_show_main");
export async function requireQuickClosed(): Promise<() => Promise<void>> {
  const token = await invoke<string>("capture_require_closed");
  return () => invoke<void>("capture_owner_changed", { token });
}
export function setCaptureScope(
  accountId: string | null,
  deviceId: string | null,
) {
  return invoke<void>("capture_scope", { accountId, deviceId });
}
export type CaptureHandoff = {
  token: string;
  accountId: string;
  deviceId: string;
  noteId: string;
};
export function listenHandoff(handler: (request: CaptureHandoff) => void) {
  return listen<CaptureHandoff>("notes-capture-handoff", (event) =>
    handler(event.payload),
  );
}
export function replyHandoff(token: string, accepted: boolean) {
  return invoke<void>("capture_handoff_result", { token, accepted });
}
export async function installQuitGuard(
  root: HTMLElement,
  onBlocked: () => void,
): Promise<() => void> {
  let active: { token: string; release: (() => void) | null } | null = null;
  let disposed = false;
  const unlock = () => {
    active?.release?.();
    active = null;
  };
  const cancel = await listen<string>("notes-quit-cancelled", (event) => {
    if (disposed || active?.token !== event.payload) return;
    unlock();
    onBlocked();
  });
  try {
    const probe = await listen<string>("notes-quit-probe", (event) => {
      if (disposed || active?.token === event.payload) return;
      // Native admits B only after A clears. Restore A's baseline before B
      // captures its freeze; A's late cancellation/reply cannot release B.
      unlock();
      const request = { token: event.payload, release: null as (() => void) | null };
      active = request;
      const allowed = checkClose() === "allowed";
      if (allowed) {
        const unfreeze = freezeWindow(root),
          unlockOperations = lockClosing();
        request.release = () => {
          unfreeze();
          unlockOperations();
        };
      } else onBlocked();
      void invoke("capture_quit_reply", {
        token: request.token,
        allowed,
      }).catch(() => {
        if (disposed || active !== request) return;
        unlock();
        onBlocked();
      });
    });
    return () => {
      disposed = true;
      probe();
      cancel();
      unlock();
    };
  } catch (error) {
    disposed = true;
    cancel();
    unlock();
    throw error;
  }
}
