import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { DesktopShell } from "../../src/desktop/DesktopShell";
import { connectWindow, isDesktop } from "../../src/desktop/window";
import { Workspace } from "../../src/ui/Workspace";
import type { NotesStore } from "../../src/domain/contracts";

vi.mock("../../src/desktop/window", () => ({
  isDesktop: vi.fn(),
  connectWindow: vi.fn(),
}));
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it("removes the resize rail when native navigation is collapsed and retains its width on reopen", async () => {
  localStorage.clear();
  vi.stubGlobal("matchMedia", () => ({
    matches: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  vi.mocked(isDesktop).mockReturnValue(true);
  const drag = vi.fn(async () => {});
  vi.mocked(connectWindow).mockResolvedValue({
    minimize: vi.fn(async () => {}),
    toggleMaximize: vi.fn(async () => {}),
    isMaximized: async () => false,
    close: vi.fn(async () => {}),
    startDragging: drag,
    showSystemMenu: vi.fn(async () => {}),
    finishClose: vi.fn(async () => {}),
    dispose: vi.fn(),
  });
  const mutation = vi.fn(async () => {
    throw new Error("Unexpected domain write");
  });
  const store: NotesStore = {
    list: async () => [],
    get: async () => null,
    create: mutation,
    update: mutation,
    trash: mutation,
    restore: mutation,
    erase: mutation,
    subscribe: () => () => {},
    persistence: () => ({ status: "ready" }),
    close: vi.fn(),
  };
  render(
    <DesktopShell>
      <Workspace
        store={store}
        session={{
          accountId: "synthetic",
          deviceId: "synthetic",
          email: "desktop-resize@example.test",
          deviceState: "trusted",
        }}
        onSignOut={async () => {}}
      />
    </DesktopShell>,
  );
  const rail = await screen.findByRole("separator", { name: "Resize sidebar" });
  fireEvent.keyDown(rail, { key: "ArrowRight" });
  expect(rail).toHaveAttribute("aria-valuenow", "240");
  fireEvent.click(screen.getByRole("button", { name: "Hide sidebar" }));
  expect(screen.queryByRole("separator")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Show sidebar" }));
  expect(await screen.findByRole("separator")).toHaveAttribute(
    "aria-valuenow",
    "240",
  );
  expect(drag).not.toHaveBeenCalled();
  expect(mutation).not.toHaveBeenCalled();
});
