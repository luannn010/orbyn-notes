import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { AccountView } from "../../src/ui/AccountView";
import type { AccountService } from "../../src/domain/contracts";

beforeEach(() => localStorage.clear());
it("offers Planner’s local-use action at entry and invite without making an account request", () => {
  const onUseLocal = vi.fn();
  const service = {
    checkInvite: vi.fn(),
    signIn: vi.fn(),
  } as unknown as AccountService;
  render(
    <AccountView
      service={service}
      onSession={vi.fn()}
      onUseLocal={onUseLocal}
    />,
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Use without an account" }),
  );
  expect(onUseLocal).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("button", { name: "Create an account" }));
  fireEvent.click(
    screen.getByRole("button", { name: "Use without an account" }),
  );
  expect(onUseLocal).toHaveBeenCalledTimes(2);
  expect(service.checkInvite).not.toHaveBeenCalled();
  expect(service.signIn).not.toHaveBeenCalled();
});

it("prefers persistent local entry over sample entry without duplicate actions", () => {
  const local = vi.fn(),
    sample = vi.fn();
  render(
    <AccountView
      service={{} as AccountService}
      onSession={vi.fn()}
      onUseLocal={local}
      onUseWithoutAccount={sample}
    />,
  );
  expect(
    screen.getAllByRole("button", { name: "Use without an account" }),
  ).toHaveLength(1);
  fireEvent.click(
    screen.getByRole("button", { name: "Use without an account" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
  fireEvent.click(
    screen.getByRole("button", { name: "Use without an account" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Back" }));
  fireEvent.click(screen.getByRole("button", { name: "Create an account" }));
  expect(
    screen.getAllByRole("button", { name: "Use without an account" }),
  ).toHaveLength(1);
  fireEvent.click(
    screen.getByRole("button", { name: "Use without an account" }),
  );
  expect(local).toHaveBeenCalledTimes(3);
  expect(sample).not.toHaveBeenCalled();
});
