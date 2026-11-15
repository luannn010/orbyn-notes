import { invoke, isTauri } from "@tauri-apps/api/core";

/** Returns false when the user cancels the native save dialog. */
export async function saveDesktopFile(
  name: string,
  blob: Blob,
  beforeWrite?: () => void | Promise<void>,
): Promise<boolean> {
  if (!isTauri()) throw new Error("Native file saving is unavailable.");
  if (blob.size > 64 * 1024 * 1024) throw new Error("Export is too large to save.");
  const bytes = Array.from(new Uint8Array(await blob.arrayBuffer()));
  const token = await invoke<string | null>("choose_export", { name });
  if (token === null) return false;
  try {
    await beforeWrite?.();
    await invoke<void>("write_export", { token, bytes });
    return true;
  } finally {
    // A consumed token is harmless; discard also releases an aborted selection.
    await invoke<void>("discard_export", { token }).catch(() => {});
  }
}
