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
  let release: (() => void) | null = null;
  const unlock = () => {
    release?.();
    release = null;
  };
  const cancel = await listen("notes-quit-cancelled", () => {
    unlock();
    onBlocked();
  });
  try {
    const probe = await listen<string>("notes-quit-probe", (event) => {
      const allowed = checkClose() === "allowed";
      if (allowed) {
        const unfreeze = freezeWindow(root),
          unlockOperations = lockClosing();
        release = () => {
          unfreeze();
          unlockOperations();
        };
      } else onBlocked();
      void invoke("capture_quit_reply", {
        token: event.payload,
        allowed,
      }).catch(() => {
        unlock();
        onBlocked();
      });
    });
    return () => {
      probe();
      cancel();
      unlock();
    };
  } catch (error) {
    cancel();
    throw error;
  }
}
