import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  signOut: vi.fn(),
  close: vi.fn(),
}));
vi.mock("../../src/account", () => ({
  createAccountService: () => ({
    close: () => {},
    current: async () => ({
      accountId: "synthetic-account",
      deviceId: "synthetic-device",
      email: "fixture@example.invalid",
      deviceState: "trusted",
    }),
    signOut: fixture.signOut,
  }),
  subscribeLock: () => () => {},
}));
vi.mock("../../src/data", () => ({
  openNotesStore: async () => ({
    list: async () => [],
    subscribe: () => () => {},
    close: fixture.close,
  }),
}));
vi.mock("../../src/ui/noteLinkOwner", () => ({
  useNoteLinkOwner: () => ({
    service: null,
    bootSettled: true,
    error: "",
    retry: vi.fn(),
  }),
}));
vi.mock("../../src/ui/studySourceOwners", () => ({
  useStudySourceOwners: () => ({
    service: null,
    collections: null,
    bootSettled: true,
    error: "",
    retry: vi.fn(),
  }),
}));
vi.mock("../../src/ui/AccountView", () => ({
  AccountView: () => <p>Signed out entry</p>,
  PendingDevice: () => <p>Device approval required</p>,
}));
import { App } from "../../src/App";

beforeEach(() => {
  localStorage.clear();
  fixture.close.mockReset();
  fixture.signOut
    .mockReset()
    .mockRejectedValueOnce(new Error("Storage unavailable"))
    .mockResolvedValue(undefined);
  vi.stubGlobal("matchMedia", () => ({
    matches: true,
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
afterEach(() => vi.unstubAllGlobals());

it("keeps App and its sign-out retry dialog open after a failed sign-out", async () => {
  render(<App />);
  fireEvent.click(
    await screen.findByRole("button", { name: "Settings" }, { timeout: 10000 }),
  );
  fireEvent.click(
    within(screen.getByRole("dialog", { name: "Settings" })).getByRole(
      "button",
      { name: "Sign out" },
    ),
  );
  const dialog = screen.getByRole("dialog", { name: "Sign out of Notes?" });
  fireEvent.click(within(dialog).getByRole("button", { name: "Sign out" }));
  await waitFor(() => {
    expect(screen.getByRole("dialog", { name: "Sign out of Notes?" })).toBe(
      dialog,
    );
    expect(within(dialog).getByRole("alert")).toHaveTextContent(
      "Couldn’t sign out. Try again.",
    );
  });
  expect(screen.getByRole("dialog", { name: "Sign out of Notes?" })).toBe(
    dialog,
  );
  expect(screen.queryByText("Notes can’t open yet")).not.toBeInTheDocument();
  expect(fixture.close).not.toHaveBeenCalled();
  const retry = within(dialog).getByRole("button", { name: "Sign out" });
  expect(retry).toBeEnabled();
  fireEvent.click(retry);
  await screen.findByText("Signed out entry");
  await waitFor(() => expect(fixture.close).toHaveBeenCalled());
  expect(fixture.signOut).toHaveBeenCalledTimes(2);
  expect(
    screen.queryByRole("dialog", { name: "Sign out of Notes?" }),
  ).not.toBeInTheDocument();
});
