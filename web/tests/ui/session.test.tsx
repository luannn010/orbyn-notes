import { render, screen, act, fireEvent, waitFor } from "@testing-library/react";
import { beforeEach, describe, it, expect, vi } from "vitest";
import type { AccountSession } from "../../src/domain/contracts";
const control = vi.hoisted(() => ({
  signOut: vi.fn(),
  lock: null as null | (() => void),
  session: {
    accountId: "a",
    deviceId: "d",
    email: "a@example.invalid",
    deviceState: "trusted",
  } as AccountSession | null,
}));
vi.mock("../../src/account", () => ({
  createAccountService: () => ({ current: async () => control.session, signOut: control.signOut }),
  subscribeLock: (listener: () => void) => {
    control.lock = listener;
    return () => {
      control.lock = null;
    };
  },
}));
vi.mock("../../src/data", () => ({
  openNotesStore: async () => ({ close: vi.fn() }),
}));
vi.mock("../../src/ui/Workspace", () => ({
  Workspace: ({ onSignOut }: { onSignOut: () => Promise<void> }) => <><p>Private library contents</p><button onClick={() => void onSignOut().catch(() => {})}>Fixture sign out</button></>,
}));
vi.mock("../../src/ui/AccountView", () => ({
  AccountView: () => <p>Signed out entry</p>,
  PendingDevice: () => <p>Device approval required</p>,
}));
import { App } from "../../src/App";
beforeEach(() => {
  control.signOut.mockReset().mockResolvedValue(undefined);
  vi.stubEnv("VITE_ENGINE_URL", "http://127.0.0.1:8089");
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  control.session = {
    accountId: "a",
    deviceId: "d",
    email: "a@example.invalid",
    deviceState: "trusted",
  };
});
describe("session boundaries", () => {
  it("keeps the mounted private workspace when sign-out fails before revocation", async () => {
    control.signOut.mockRejectedValue(new Error("synthetic network failure"));
    render(<App />);
    await screen.findByText("Private library contents");
    fireEvent.click(screen.getByRole("button", { name: "Fixture sign out" }));
    await waitFor(() => expect(control.signOut).toHaveBeenCalledOnce());
    await act(async () => {});
    expect(screen.getByText("Private library contents")).toBeVisible();
    expect(screen.queryByText("Notes can’t open yet")).not.toBeInTheDocument();
  });
  it("removes decrypted UI immediately on a cross-tab lock", async () => {
    render(<App />);
    await screen.findByText("Private library contents");
    act(() => control.lock?.());
    expect(
      screen.queryByText("Private library contents"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Signed out entry")).toBeVisible();
  });
  it("never opens notes for a pending device", async () => {
    control.session = { ...control.session!, deviceState: "pending" };
    render(<App />);
    await screen.findByText("Device approval required");
    expect(
      screen.queryByText("Private library contents"),
    ).not.toBeInTheDocument();
  });
  it("shows explicit unavailability without engine configuration", async () => {
    vi.stubEnv("VITE_ENGINE_URL", "");
    control.session = null;
    render(<App />);
    await screen.findByText("Notes can’t open yet");
    expect(screen.queryByText("Signed out entry")).not.toBeInTheDocument();
  });
  it("opens a locally unlocked library without account network configuration", async () => {
    vi.stubEnv("VITE_ENGINE_URL", "");
    render(<App />);
    await screen.findByText("Private library contents");
  });
});
