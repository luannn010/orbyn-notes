import { act, fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { AccountService } from "../../src/domain/contracts";
import { PendingDevice } from "../../src/ui/AccountView";

function setup() {
  const pendingDevice = vi
    .fn()
    .mockResolvedValueOnce({ status: "compare", sas: "123456" });
  const confirmDevice = vi.fn();
  const onSession = vi.fn();
  const service = { pendingDevice, confirmDevice } as unknown as AccountService;
  render(
    <PendingDevice
      service={service}
      onSession={onSession}
      onSignOut={vi.fn()}
    />,
  );
  return { pendingDevice, confirmDevice, onSession };
}
async function showComparison() {
  fireEvent.click(screen.getByRole("button", { name: "Check approval" }));
  await screen.findByText("123456");
}
it("removes obsolete digits immediately on refresh and keeps them absent when waiting", async () => {
  const { pendingDevice, confirmDevice } = setup();
  let complete!: (value: { status: "waiting" }) => void;
  pendingDevice.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  await showComparison();
  fireEvent.click(screen.getByRole("button", { name: "Check approval" }));
  expect(screen.queryByText("123456")).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "The digits match" }),
  ).not.toBeInTheDocument();
  await act(async () => complete({ status: "waiting" }));
  expect(screen.queryByText("123456")).not.toBeInTheDocument();
  expect(confirmDevice).not.toHaveBeenCalled();
});
it("clears obsolete digits when a refresh fails and displays the error", async () => {
  const { pendingDevice } = setup();
  pendingDevice.mockRejectedValueOnce(new Error("Refresh failed"));
  await showComparison();
  fireEvent.click(screen.getByRole("button", { name: "Check approval" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Refresh failed");
  expect(screen.queryByText("123456")).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "The digits match" }),
  ).not.toBeInTheDocument();
});
it("requires a fresh comparison after confirmation fails", async () => {
  const { pendingDevice, confirmDevice, onSession } = setup();
  confirmDevice.mockRejectedValueOnce(new Error("Approval expired"));
  pendingDevice.mockResolvedValueOnce({ status: "compare", sas: "654321" });
  await showComparison();
  fireEvent.click(screen.getByRole("button", { name: "The digits match" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Approval expired",
  );
  expect(confirmDevice).toHaveBeenCalledWith("123456");
  expect(onSession).not.toHaveBeenCalled();
  expect(screen.queryByText("123456")).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "The digits match" }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Check approval" }));
  expect(await screen.findByText("654321")).toBeVisible();
});
