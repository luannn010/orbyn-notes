import {
  fireEvent,
  render,
  screen,
  within,
  waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Workspace } from "../../src/ui/Workspace";
import type { NotesStore } from "../../src/domain/contracts";

beforeEach(() => {
  localStorage.clear();
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
async function mount() {
  const store = {
    list: vi.fn().mockResolvedValue([]),
    subscribe: () => () => {},
    erase: vi.fn().mockResolvedValue(undefined),
  } as unknown as NotesStore;
  const view = render(
    <Workspace
      store={store}
      session={{
        accountId: "test",
        deviceId: "test",
        email: "fixture@example.invalid",
        deviceState: "trusted",
      }}
      onSignOut={vi.fn()}
    />,
  );
  const trigger = await screen.findByRole("button", { name: "Settings" });
  trigger.focus();
  fireEvent.click(trigger);
  return {
    store,
    view,
    trigger,
    dialog: screen.getByRole("dialog", { name: "Settings" }),
  };
}
describe("settings", () => {
  it("selects sections and persists real preferences across remount", async () => {
    const { dialog, view } = await mount();
    expect(
      within(dialog).getByRole("button", { name: "General" }),
    ).toHaveAttribute("aria-current", "page");
    fireEvent.click(
      within(
        within(dialog).getByRole("group", { name: "Appearance" }),
      ).getByRole("button", { name: "Dim" }),
    );
    fireEvent.click(
      within(within(dialog).getByRole("group", { name: "Motion" })).getByRole(
        "button",
        { name: "Reduced" },
      ),
    );
    await waitFor(() =>
      expect(localStorage.getItem("notes.theme")).toBe("dim"),
    );
    expect(localStorage.getItem("notes.motion")).toBe("reduced");
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Data and export" }),
    );
    expect(
      within(dialog).getByRole("button", { name: "Data and export" }),
    ).toHaveAttribute("aria-current", "page");
    expect(
      within(dialog).queryByRole("group", { name: "Appearance" }),
    ).not.toBeInTheDocument();
    view.unmount();
    const again = await mount();
    expect(
      within(
        within(again.dialog).getByRole("group", { name: "Appearance" }),
      ).getByRole("button", { name: "Dim" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      within(
        within(again.dialog).getByRole("group", { name: "Motion" }),
      ).getByRole("button", { name: "Reduced" }),
    ).toHaveAttribute("aria-pressed", "true");
  });
  it("opens and cancels export and erase without effects and restores focus", async () => {
    const { dialog, store, trigger } = await mount();
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Data and export" }),
    );
    const exportButton = within(dialog).getByRole("button", {
      name: "Export all notes",
    });
    exportButton.focus();
    fireEvent.click(exportButton);
    const exportDialog = screen.getByRole("dialog", {
      name: "Export Markdown",
    });
    fireEvent.click(
      within(exportDialog).getByRole("button", { name: "Cancel" }),
    );
    expect(exportButton).toHaveFocus();
    const eraseButton = within(dialog).getByRole("button", {
      name: "Erase this browser",
    });
    eraseButton.focus();
    fireEvent.click(eraseButton);
    const eraseDialog = screen.getByRole("dialog", {
      name: "Erase notes from this browser?",
    });
    expect(
      within(eraseDialog).getByRole("button", { name: "Erase notes" }),
    ).toBeDisabled();
    fireEvent.click(
      within(eraseDialog).getByRole("button", { name: "Cancel" }),
    );
    expect(eraseButton).toHaveFocus();
    expect(store.erase).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Done" }));
    expect(trigger).toHaveFocus();
  });
  it("requires confirmation before erasing", async () => {
    const { dialog, store } = await mount();
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Data and export" }),
    );
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Erase this browser" }),
    );
    const confirmation = screen.getByRole("dialog", {
      name: "Erase notes from this browser?",
    });
    fireEvent.change(
      within(confirmation).getByLabelText("Type ERASE to confirm"),
      { target: { value: "ERASE" } },
    );
    fireEvent.click(
      within(confirmation).getByRole("button", { name: "Erase notes" }),
    );
    await waitFor(() => expect(store.erase).toHaveBeenCalledTimes(1));
  });
});
