import { useEffect, useRef, useState, type ReactNode } from "react";
export function readPreference(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writePreference(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* Preferences remain usable when browser storage is denied. */
  }
}
export function applyInitialPreferences() {
  const theme = readPreference("notes.theme");
  document.documentElement.dataset.theme =
    theme === "light" || theme === "dark" || theme === "dim"
      ? theme
      : matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
  document.documentElement.dataset.motion =
    readPreference("notes.motion") ?? "system";
}
export function Dialog({
  title,
  children,
  onClose,
  className,
  returnFocusTo,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  className?: string;
  returnFocusTo?: HTMLElement | null;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const dialog = ref.current;
    dialog?.showModal();
    return () => {
      dialog?.close();
      (returnFocusTo ?? previous)?.focus();
    };
  }, []);
  return (
    <dialog
      aria-label={title}
      className={className}
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <h2>{title}</h2>
      {children}
    </dialog>
  );
}
export type Theme = "system" | "light" | "dark" | "dim";
export function usePreferences() {
  const [theme, setTheme] = useState<Theme>(() => {
    const value = readPreference("notes.theme");
    return value === "light" || value === "dark" || value === "dim"
      ? value
      : "system";
  });
  const [motion, setMotion] = useState(
    () => readPreference("notes.motion") ?? "system",
  );
  useEffect(() => {
    const query = matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      document.documentElement.dataset.theme =
        theme === "system" ? (query.matches ? "dark" : "light") : theme;
    };
    apply();
    query.addEventListener("change", apply);
    writePreference("notes.theme", theme);
    return () => query.removeEventListener("change", apply);
  }, [theme]);
  useEffect(() => {
    document.documentElement.dataset.motion = motion;
    writePreference("notes.motion", motion);
  }, [motion]);
  return { theme, setTheme, motion, setMotion };
}
