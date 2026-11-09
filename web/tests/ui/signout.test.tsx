import {
  fireEvent,
  render,
  screen,
  within,
  waitFor,
} from "@testing-library/react";
import { beforeEach, describe, it, expect, vi } from "vitest";
import { Workspace } from "../../src/ui/Workspace";
import type { NotesStore } from "../../src/domain/contracts";
beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
});
async function mount(onSignOut: () => Promise<void>) {
  const store = {
    list: vi.fn().mockResolvedValue([]),
    subscribe: () => () => {},
    close: vi.fn(),
  } as unknown as NotesStore;
  render(
    <Workspace
      store={store}
      session={{
        accountId: "test",
        deviceId: "test",
        email: "fixture@example.invalid",
        deviceState: "trusted",
      }}
      onSignOut={onSignOut}
    />,
  );
  fireEvent.click(await screen.findByRole("button", { name: "Settings" }));
  fireEvent.click(
    within(screen.getByRole("dialog", { name: "Settings" })).getByRole(
      "button",
      { name: "Sign out" },
    ),
  );
  return screen.getByRole("dialog", { name: "Sign out of Notes?" });
}
describe("sign-out confirmation", () => {
  it("retains the library unless explicitly confirmed", async () => {
    const signOut = vi.fn().mockResolvedValue(undefined);
    const dialog = await mount(signOut);
    expect(
      within(dialog).getByText(
        "Your encrypted notes stay in this browser. Sign in to the same account in this browser to open them again. They are not backed up or synced.",
      ),
    ).toBeVisible();
    expect(signOut).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByText("Cancel"));
    expect(
      screen.queryByRole("dialog", { name: "Sign out of Notes?" }),
    ).not.toBeInTheDocument();
    expect(signOut).not.toHaveBeenCalled();
  });
  it("awaits the callback and prevents repeat submissions", async () => {
    let complete!: () => void;
    const signOut = vi.fn(
      () => new Promise<void>((resolve) => (complete = resolve)),
    );
    const dialog = await mount(signOut);
    fireEvent.click(within(dialog).getByRole("button", { name: "Sign out" }));
    expect(within(dialog).getByText("Signing out…")).toBeDisabled();
    expect(within(dialog).getByText("Cancel")).toBeDisabled();
    expect(signOut).toHaveBeenCalledTimes(1);
    complete();
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Sign out of Notes?" }),
      ).not.toBeInTheDocument(),
    );
  });
  it("keeps the confirmation open and allows retry after failure", async () => {
    const signOut = vi
      .fn()
      .mockRejectedValueOnce(new Error("Network unavailable"))
      .mockResolvedValue(undefined);
    const dialog = await mount(signOut);
    fireEvent.click(within(dialog).getByRole("button", { name: "Sign out" }));
    await within(dialog).findByRole("alert");
    expect(
      within(dialog).getByRole("button", { name: "Sign out" }),
    ).toBeEnabled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Sign out" }));
    await waitFor(() => expect(signOut).toHaveBeenCalledTimes(2));
  });
});
