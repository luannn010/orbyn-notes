import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Workspace } from "../../src/ui/Workspace";
import type { NotesStore } from "../../src/domain/contracts";

let wide = true;
const mediaListeners = new Set<() => void>();
beforeEach(() => {
  localStorage.clear();
  wide = true;
  mediaListeners.clear();
  vi.stubGlobal("matchMedia", () => ({
    get matches() {
      return wide;
    },
    addEventListener: (_: string, listener: () => void) =>
      mediaListeners.add(listener),
    removeEventListener: (_: string, listener: () => void) =>
      mediaListeners.delete(listener),
  }));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function workspace() {
  const unsupported = vi.fn(async () => {
    throw new Error("Unexpected domain mutation");
  });
  const store: NotesStore = {
    list: async () => [],
    get: async () => null,
    create: unsupported,
    update: unsupported,
    trash: unsupported,
    restore: unsupported,
    erase: unsupported,
    subscribe: () => () => {},
    persistence: () => ({ status: "ready" }),
    close: vi.fn(),
  };
  const view = render(
    <Workspace
      store={store}
      session={{
        accountId: "synthetic",
        deviceId: "synthetic",
        email: "resize@example.test",
        deviceState: "trusted",
      }}
      onSignOut={async () => {}}
    />,
  );
  return { view, unsupported };
}
it("persists only the width preference and restores it on remount without a domain write", async () => {
  const { view, unsupported } = workspace();
  let rail = await screen.findByRole("separator", { name: "Resize sidebar" });
  fireEvent.keyDown(rail, { key: "ArrowRight" });
  expect(rail).toHaveAttribute("aria-valuenow", "240");
  expect(localStorage.getItem("notes.sidebar-width")).toBe("240");
  view.unmount();
  workspace();
  rail = await screen.findByRole("separator", { name: "Resize sidebar" });
  expect(rail).toHaveAttribute("aria-valuenow", "240");
  expect(unsupported).not.toHaveBeenCalled();
});
it.each(["NaN", "Infinity", "179", "421", "", "-10", "999999", "240px"])(
  "rejects invalid stored width %j",
  async (value) => {
    localStorage.setItem("notes.sidebar-width", value);
    workspace();
    expect(await screen.findByRole("separator")).toHaveAttribute(
      "aria-valuenow",
      "224",
    );
  },
);
it("keeps resizing usable when preference storage is denied", async () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new DOMException("Denied", "SecurityError");
  });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new DOMException("Denied", "SecurityError");
  });
  workspace();
  const rail = await screen.findByRole("separator");
  fireEvent.keyDown(rail, { key: "ArrowRight" });
  expect(rail).toHaveAttribute("aria-valuenow", "240");
});
it("removes resizing on narrow layouts and restores the wide width when returning", async () => {
  workspace();
  const rail = await screen.findByRole("separator");
  fireEvent.keyDown(rail, { key: "ArrowRight" });
  act(() => {
    wide = false;
    mediaListeners.forEach((listener) => listener());
  });
  expect(screen.queryByRole("separator")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Open navigation" }));
  expect(
    screen.getByRole("dialog", { name: "Notes navigation" }),
  ).toBeInTheDocument();
  expect(screen.queryByRole("separator")).not.toBeInTheDocument();
  act(() => {
    wide = true;
    mediaListeners.forEach((listener) => listener());
  });
  expect(await screen.findByRole("separator")).toHaveAttribute(
    "aria-valuenow",
    "240",
  );
});
