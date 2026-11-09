import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { AccountView, PendingDevice } from "../../src/ui/AccountView";
import type { AccountService } from "../../src/domain/contracts";
const service = (): AccountService => ({
  current: vi.fn(),
  checkInvite: vi.fn().mockResolvedValue(undefined),
  register: vi.fn(),
  verifyEmail: vi.fn(),
  resendEmail: vi.fn(),
  signIn: vi.fn(),
  signOut: vi.fn(),
  pendingDevice: vi.fn(),
  confirmDevice: vi.fn(),
  cancelDevice: vi.fn(),
  completeSecondFactor: vi.fn(),
});
describe("account views", () => {
  it("requires a complete invite before moving to credentials", async () => {
    const account = service();
    render(<AccountView service={account} onSession={vi.fn()} />);
    fireEvent.click(screen.getByText("Create an account"));
    fireEvent.change(screen.getByLabelText("Invite code"), {
      target: { value: "abcd1234efgh5678" },
    });
    expect(screen.getByLabelText("Invite code")).toHaveValue(
      "ABCD-1234-EFGH-5678",
    );
    fireEvent.click(screen.getByText("Continue"));
    await screen.findByLabelText("Email");
    expect(account.checkInvite).toHaveBeenCalledWith("ABCD-1234-EFGH-5678");
  });
  it("retains credentials and shows a retryable sign-in failure", async () => {
    const account = service();
    vi.mocked(account.signIn).mockRejectedValue(
      new Error("Couldn’t connect. Try again."),
    );
    render(<AccountView service={account} onSession={vi.fn()} />);
    fireEvent.click(screen.getByText("Sign in"));
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "person@example.org" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "long-password" },
    });
    fireEvent.click(screen.getByText("Sign in"));
    await screen.findByRole("alert");
    expect(screen.getByLabelText("Email")).toHaveValue("person@example.org");
    expect(screen.getByLabelText("Password")).toHaveValue("long-password");
  });
  it("requires the human comparison before confirmDevice", async () => {
    const account = service();
    vi.mocked(account.pendingDevice).mockResolvedValue({
      status: "compare",
      sas: "123456",
    });
    render(
      <PendingDevice
        service={account}
        onSession={vi.fn()}
        onSignOut={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText("Check approval"));
    await screen.findByText("123456");
    expect(account.confirmDevice).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("The digits match"));
    await waitFor(() =>
      expect(account.confirmDevice).toHaveBeenCalledWith("123456"),
    );
  });
});
