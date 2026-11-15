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
