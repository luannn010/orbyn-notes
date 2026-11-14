import { useLayoutEffect, useSyncExternalStore } from "react";

export type EditorPreferences = Readonly<{
  textSize: "small" | "medium" | "large";
  lineWidth: "narrow" | "wide";
  markdown: boolean;
  spellcheck: boolean;
}>;
const KEY = "notes.editor.v1";
const defaults: EditorPreferences = Object.freeze({
  textSize: "medium",
  lineWidth: "narrow",
  markdown: true,
  spellcheck: true,
});
let cached: EditorPreferences = defaults;
let observed: string | null | undefined;
let memoryOnly = false;
const listeners = new Set<() => void>();
function parse(raw: string | null): EditorPreferences {
  if (!raw || raw.length > 1000) return defaults;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value))
      return defaults;
    const item = value as Record<string, unknown>;
    if (
      Object.keys(item).length !== 4 ||
      !["small", "medium", "large"].includes(String(item.textSize)) ||
      !["narrow", "wide"].includes(String(item.lineWidth)) ||
      typeof item.markdown !== "boolean" ||
      typeof item.spellcheck !== "boolean"
    )
      return defaults;
    return Object.freeze({
      textSize: item.textSize as EditorPreferences["textSize"],
      lineWidth: item.lineWidth as EditorPreferences["lineWidth"],
      markdown: item.markdown,
      spellcheck: item.spellcheck,
    });
  } catch {
    return defaults;
  }
}
function snapshot(): EditorPreferences {
  if (!memoryOnly) {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw !== observed) {
        observed = raw;
        cached = parse(raw);
      }
    } catch {
      memoryOnly = true;
    }
  }
  return cached;
}
function changed() {
  for (const listener of listeners) listener();
}
function storage(event: StorageEvent) {
  if (event.key !== null && event.key !== KEY) return;
  memoryOnly = false;
  observed = undefined;
  snapshot();
  changed();
}
function subscribe(listener: () => void): () => void {
  if (!listeners.size) window.addEventListener("storage", storage);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (!listeners.size) window.removeEventListener("storage", storage);
  };
}
function update(patch: Partial<EditorPreferences>) {
  const next = { ...snapshot(), ...patch },
    raw = JSON.stringify(next);
  const checked = parse(raw);
  if (JSON.stringify(checked) !== raw)
    throw new Error("Unsupported editor preference.");
  cached = checked;
  try {
    localStorage.setItem(KEY, raw);
    observed = raw;
    memoryOnly = false;
  } catch {
    memoryOnly = true;
  }
  changed();
}
/** Device-only presentation choices. Never includes note or Journal content. */
export function useEditorPreferences() {
  const preferences = useSyncExternalStore(subscribe, snapshot, () => defaults);
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.style.setProperty(
      "--notes-editor-size",
      `${{ small: 12, medium: 14, large: 16 }[preferences.textSize]}px`,
    );
    root.style.setProperty(
      "--notes-editor-width",
      preferences.lineWidth === "narrow" ? "640px" : "800px",
    );
  }, [preferences]);
  return { preferences, setPreferences: update };
}
