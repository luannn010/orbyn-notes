import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AccountError } from "../../src/domain/contracts";

const fixture = vi.hoisted(() => ({
  current: vi.fn(),
  signIn: vi.fn(),
  signOut: vi.fn(),
  openStore: vi.fn(),
  openLocal: vi.fn(),
  local: false,
}));
vi.mock("../../src/account", () => ({
  createAccountService: () => ({
    current: fixture.current,
    signIn: fixture.signIn,
    signOut: fixture.signOut,
    close: vi.fn(),
  }),
  subscribeLock: () => () => {},
}));
vi.mock("../../src/data", () => ({ openNotesStore: fixture.openStore }));
vi.mock("../../src/data/local", async (original) => ({
  ...(await original<typeof import("../../src/data/local")>()),
  localModeSelected: () => fixture.local,
  openLocalSession: fixture.openLocal,
}));
import { App } from "../../src/App";

beforeEach(() => {
  localStorage.clear();
  fixture.local = false;
  fixture.current.mockReset();
  fixture.openLocal.mockReset();
  fixture.openStore.mockReset();
  fixture.signOut.mockReset();
  fixture.signIn
    .mockReset()
    .mockRejectedValue(
      new AccountError("auth_failed", "Check your email and password."),
    );
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
});
afterEach(() => vi.unstubAllGlobals());

it("allows password sign-in after rejecting an invalid local grant, without opening Notes", async () => {
  fixture.current.mockRejectedValue(
    new AccountError(
      "local_access_invalid",
      "This browser's saved access could not be verified.",
    ),
  );
  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: "Sign in" }));
  fireEvent.change(screen.getByLabelText("Email"), {
    target: { value: "fixture@example.test" },
  });
  fireEvent.change(screen.getByLabelText("Password"), {
    target: { value: "synthetic-password" },
  });
  fireEvent.submit(screen.getByLabelText("Email").closest("form")!);
  await waitFor(() =>
    expect(fixture.signIn).toHaveBeenCalledWith({
      email: "fixture@example.test",
      password: "synthetic-password",
    }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Check your email and password.",
  );
  expect(fixture.openStore).not.toHaveBeenCalled();
  expect(fixture.signOut).not.toHaveBeenCalled();
});

it("keeps the existing retry screen for other bootstrap failures", async () => {
  fixture.current.mockRejectedValue(new Error("Service unavailable"));
  render(<App />);
  expect(
    await screen.findByRole("button", { name: "Try again" }),
  ).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "Sign in" }),
  ).not.toBeInTheDocument();
  expect(fixture.openStore).not.toHaveBeenCalled();
});

it("does not redirect local-workspace failures into account sign-in", async () => {
  fixture.local = true;
  fixture.openLocal.mockRejectedValue(
    new AccountError("local_access_invalid", "Local workspace cannot open."),
  );
  render(<App />);
  expect(
    await screen.findByRole("button", { name: "Try again" }),
  ).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "Sign in" }),
  ).not.toBeInTheDocument();
  expect(fixture.current).not.toHaveBeenCalled();
  expect(fixture.openStore).not.toHaveBeenCalled();
});
