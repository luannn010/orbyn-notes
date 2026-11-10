import { useState } from "react";
import { Download, Settings } from "lucide-react";
import type { Theme, usePreferences } from "./primitives";

export function SettingsView({
  email,
  preferences,
  onSignOut,
  onExport,
  onErase,
  onDone,
}: {
  email: string;
  preferences: ReturnType<typeof usePreferences>;
  onSignOut: () => void;
  onExport: () => void;
  onErase: () => void;
  onDone: () => void;
}) {
  const [section, setSection] = useState<"general" | "data">("general");
  return (
    <div className="settings-layout">
      <nav className="settings-nav" aria-label="Settings sections">
        <button
          aria-current={section === "general" ? "page" : undefined}
          onClick={() => setSection("general")}
        >
          <Settings size={15} />
          General
        </button>
        <button
          aria-current={section === "data" ? "page" : undefined}
          onClick={() => setSection("data")}
        >
          <Download size={15} />
          Data and export
        </button>
      </nav>
      <div className="settings-pane">
        <header className="settings-heading">
          <h3>{section === "general" ? "General" : "Data and export"}</h3>
          <button onClick={onDone}>Done</button>
        </header>
        <div className="settings-content">
          {section === "general" ? (
            <>
              <div className="settings-row">
                <div>
                  <b>Account</b>
                  <small>{email}</small>
                </div>
                <button onClick={onSignOut}>Sign out</button>
              </div>
              <div className="settings-row">
                <div>
                  <b>Appearance</b>
                </div>
                <div
                  className="settings-segments"
                  role="group"
                  aria-label="Appearance"
                >
                  {(["system", "light", "dark", "dim"] as Theme[]).map(
                    (value) => (
                      <button
                        key={value}
                        aria-pressed={preferences.theme === value}
                        onClick={() => preferences.setTheme(value)}
                      >
                        {value[0]?.toUpperCase()}
                        {value.slice(1)}
                      </button>
                    ),
                  )}
                </div>
              </div>
              <div className="settings-row">
                <div>
                  <b>Motion</b>
                </div>
                <div
                  className="settings-segments"
                  role="group"
                  aria-label="Motion"
                >
                  {["system", "on", "reduced"].map((value) => (
                    <button
                      key={value}
                      aria-pressed={preferences.motion === value}
                      onClick={() => preferences.setMotion(value)}
                    >
                      {value[0]?.toUpperCase()}
                      {value.slice(1)}
                    </button>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="settings-row">
                <div>
                  <b>Export all notes</b>
                  <small>
                    Local only. Clearing browser data removes your notes. Export
                    a copy first.
                  </small>
                </div>
                <button onClick={onExport}>Export all notes</button>
              </div>
              <div className="settings-row">
                <div>
                  <b>Erase this browser</b>
                </div>
                <button className="danger" onClick={onErase}>
                  Erase this browser
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
