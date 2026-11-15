import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SettingsView } from "../../src/ui/SettingsView";
import { SettingsSurface } from "../../src/ui/SettingsSurface";

const desktop = vi.hoisted(() => ({ sidebarExpanded: true }));
vi.mock("../../src/desktop/DesktopShell", () => ({ useDesktop: () => desktop }));
vi.mock("../../src/ui/editorPreferences", () => ({ useEditorPreferences: () => ({ preferences: {}, setPreferences: vi.fn() }) }));
afterEach(() => { document.body.replaceChildren(); desktop.sidebarExpanded = true; });

describe("desktop settings", () => {
  it("filters navigation and reports an empty result", () => {
    render(<SettingsView email="user@example.com" preferences={{ theme: "light", setTheme: vi.fn(), motion: "on", setMotion: vi.fn() }} onSignOut={vi.fn()} onExport={vi.fn()} onErase={vi.fn()} onDone={vi.fn()} />);
    const search = screen.getByRole("textbox", { name: "Find a setting" });
    fireEvent.change(search, { target: { value: "journal" } });
    expect(screen.getByRole("button", { name: "Journal" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Editor" })).toBeNull();
    fireEvent.change(search, { target: { value: "nothing matches" } });
    expect(screen.getByRole("status").textContent).toContain("No settings found");
  });
  it("keeps the rail expanded while focused after the pointer leaves", () => {
    desktop.sidebarExpanded = false;
    render(<SettingsView email="user@example.com" preferences={{ theme: "light", setTheme: vi.fn(), motion: "on", setMotion: vi.fn() }} onSignOut={vi.fn()} onExport={vi.fn()} onErase={vi.fn()} onDone={vi.fn()} />);
    const nav = screen.getByRole("navigation", { name: "Settings sections" });
    const layout = nav.parentElement!;
    fireEvent.pointerEnter(nav, { pointerType: "mouse" });
    fireEvent.focus(screen.getByRole("button", { name: "General" }));
    fireEvent.pointerLeave(nav, { pointerType: "mouse" });
    expect(layout.getAttribute("data-settings-expanded")).toBe("true");
    fireEvent.keyDown(nav, { key: "Escape" });
    expect(layout.getAttribute("data-settings-expanded")).toBe("false");
  });
  it("does not peek on touch pointer entry", () => {
    desktop.sidebarExpanded = false;
    render(<SettingsView email="user@example.com" preferences={{ theme: "light", setTheme: vi.fn(), motion: "on", setMotion: vi.fn() }} onSignOut={vi.fn()} onExport={vi.fn()} onErase={vi.fn()} onDone={vi.fn()} />);
    const nav = screen.getByRole("navigation", { name: "Settings sections" });
    fireEvent.pointerEnter(nav, { pointerType: "touch" });
    expect(nav.parentElement!.getAttribute("data-settings-expanded")).toBe("false");
  });
  it("honors sample surface and rail overrides without changing normal desktop defaults", () => {
    const props = { email: "", preferences: { theme: "light" as const, setTheme: vi.fn(), motion: "on" as const, setMotion: vi.fn() }, onSignOut: vi.fn(), onExport: vi.fn(), onErase: vi.fn(), onDone: vi.fn() };
    const view = render(<SettingsView {...props} sampleWorkspace desktopSurface sidebarExpanded={false} />);
    const nav = screen.getByRole("navigation", { name: "Settings sections" });
    expect(nav.parentElement).toHaveAttribute("data-settings-pinned", "false");
    expect(nav.parentElement).toHaveAttribute("data-settings-expanded", "false");
    expect(screen.getByText("Sample workspace")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Sign out" })).toBeNull();
    view.rerender(<SettingsView {...props} desktopSurface={false} />);
    expect(screen.queryByRole("textbox", { name: "Find a setting" })).toBeNull();
    expect(screen.getByRole("button", { name: "Done" })).toBeVisible();
    view.rerender(<SettingsView {...props} />);
    expect(screen.getByRole("textbox", { name: "Find a setting" })).toBeVisible();
    expect(nav.parentElement).toHaveAttribute("data-settings-pinned", "true");
    expect(screen.queryByRole("button", { name: "Done" })).toBeNull();
  });
  it("focuses the surface, closes on Escape and restores focus", () => {
    const trigger = document.createElement("button");
    document.body.append(trigger);
    trigger.focus();
    const close = vi.fn();
    const view = render(<SettingsSurface onClose={close} returnFocusTo={trigger}><button>Back</button></SettingsSurface>);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Back" }));
    const menu = document.createElement("div");
    menu.setAttribute("role", "menu");
    document.body.append(menu);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(close).not.toHaveBeenCalled();
    menu.remove();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(close).toHaveBeenCalledOnce();
    view.unmount();
    expect(document.activeElement).toBe(trigger);
  });
});
