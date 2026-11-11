import { isTauri } from "@tauri-apps/api/core";

export const isDesktop = () => isTauri();
export type DesktopWindow = {
  minimize(): Promise<void>;
  toggleMaximize(): Promise<void>;
  isMaximized(): Promise<boolean>;
  close(): Promise<void>;
  startDragging(): Promise<void>;
  showSystemMenu(): Promise<void>;
  finishClose(requestId: number): Promise<void>;
  dispose(): void;
};

export async function connectWindow(
  onClose: (requestId: number) => void,
  onResize: () => void,
): Promise<DesktopWindow> {
  const [{ getCurrentWindow }, { listen }, { invoke }] = await Promise.all([
    import("@tauri-apps/api/window"), import("@tauri-apps/api/event"), import("@tauri-apps/api/core"),
  ]);
  const window = getCurrentWindow();
  const unlisten = await listen<{ requestId: number }>("notes-close-requested", ({ payload }) => {
    if (Number.isSafeInteger(payload.requestId) && payload.requestId > 0) onClose(payload.requestId);
  });
  try {
    const unresize = await window.onResized(onResize);
    return {
      minimize: () => window.minimize(),
      toggleMaximize: () => window.toggleMaximize(),
      isMaximized: () => window.isMaximized(),
      close: () => window.close(),
      startDragging: () => window.startDragging(),
      showSystemMenu: () => invoke("show_system_menu"),
      finishClose: (requestId) => invoke("finish_close", { requestId }),
      dispose: () => { unlisten(); unresize(); },
    };
  } catch (error) { unlisten(); throw error; }
}
