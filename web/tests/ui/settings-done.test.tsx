import { fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { SettingsView } from "../../src/ui/SettingsView";

const styles = readFileSync(
  `${process.cwd()}/src/styles/settings-motion.css`,
  "utf8",
);

function declarations(selector: string) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const rule = styles.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  return (rule?.[1] ?? "").replace(/\s+/g, " ").toLowerCase();
}

function props() {
  return {
    email: "user@example.com",
    preferences: {
      theme: "light" as const,
      setTheme: vi.fn(),
      motion: "on" as const,
      setMotion: vi.fn(),
    },
    onSignOut: vi.fn(),
    onExport: vi.fn(),
    onErase: vi.fn(),
    onDone: vi.fn(),
  };
}

describe("settings dialog Done", () => {
  it("pins the section header and Done while the dialog scrolls", () => {
    expect(declarations(".settings-dialog .settings-pane")).toContain(
      "overflow: visible",
    );
    expect(declarations(".settings-dialog .settings-heading")).toContain(
      "position: sticky",
    );
    expect(declarations(".settings-dialog .settings-heading")).toContain(
      "background: var(--main)",
    );
    expect(declarations(".settings-dialog .settings-motion-done")).toContain(
      "position: sticky",
    );
    expect(declarations(".settings-dialog .settings-motion-done")).toContain(
      "top: 22px",
    );
  });

  it("keeps the single Done outside the inert motion panes", () => {
    const onDone = vi.fn();
    render(<SettingsView {...props()} onDone={onDone} />);
    const done = screen.getByRole("button", { name: "Done" });
    expect(screen.getAllByRole("button", { name: "Done" })).toHaveLength(1);
    expect(done.closest(".settings-motion-pane")).toBeNull();
    expect(done.closest("[inert]")).toBeNull();
    fireEvent.click(done);
    expect(onDone).toHaveBeenCalledOnce();
  });
});
