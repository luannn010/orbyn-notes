import { invoke, isTauri } from "@tauri-apps/api/core";

const FAILURE =
  "Could not open the source. Copy its URL and open it in your browser.";

/** Native-only handoff. Browser presentation uses a normal safe external anchor. */
export async function openExternalUrl(url: string): Promise<void> {
  try {
    if (typeof url !== "string" || url.length > 8192) throw new Error();
    const authority = /^https?:\/\/([^/?#]+)/i.exec(url)?.[1];
    if (
      !authority ||
      authority.includes("@") ||
      /[\u0000-\u0020\u007f\\]/.test(url)
    )
      throw new Error();
    const parsed = new URL(url);
    if (
      !["http:", "https:"].includes(parsed.protocol) ||
      !parsed.hostname ||
      parsed.username ||
      parsed.password ||
      !isTauri()
    )
      throw new Error();
    await invoke<void>("open_external_url", { url });
  } catch {
    throw new Error(FAILURE);
  }
}
