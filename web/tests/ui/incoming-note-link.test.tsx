import { fireEvent, render, screen, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { IncomingNoteLink } from "../../src/ui/noteLinks/IncomingNoteLink";
it("announces opening without offering a false cancellation or automatic retry", () => {
  const retry = vi.fn(),
    dismiss = vi.fn();
  const view = render(
    <IncomingNoteLink state="opening" onRetry={retry} onDismiss={dismiss} />,
  );
  expect(
    screen.getByRole("status", { name: "Incoming note link" }),
  ).toHaveTextContent("Opening note…");
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
  view.rerender(
    <IncomingNoteLink state="blocked" onRetry={retry} onDismiss={dismiss} />,
  );
  expect(retry).not.toHaveBeenCalled();
  expect(dismiss).not.toHaveBeenCalled();
  expect(screen.getByRole("status")).toHaveTextContent(
    "Finish your current work before opening this note.",
  );
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(retry).toHaveBeenCalledTimes(1);
  expect(dismiss).not.toHaveBeenCalled();
});
it.each(["blocked", "unavailable"] as const)(
  "offers explicit retry and dismissal only for settled %s state",
  (state) => {
    const retry = vi.fn(),
      dismiss = vi.fn();
    render(
      <IncomingNoteLink state={state} onRetry={retry} onDismiss={dismiss} />,
    );
    const notice = screen.getByRole("status", { name: "Incoming note link" });
    expect(within(notice).getAllByRole("button")).toHaveLength(2);
    fireEvent.click(within(notice).getByRole("button", { name: "Dismiss" }));
    expect(dismiss).toHaveBeenCalledTimes(1);
    expect(retry).not.toHaveBeenCalled();
    if (state === "unavailable")
      expect(notice).toHaveTextContent(
        "This note isn’t available in this workspace.",
      );
  },
);
it("keeps malformed ingress content out of the notice and provides no invalid-link retry", () => {
  const retry = vi.fn(),
    dismiss = vi.fn();
  render(
    <IncomingNoteLink state="invalid" onRetry={retry} onDismiss={dismiss} />,
  );
  const notice = screen.getByRole("alert", { name: "Incoming note link" });
  expect(notice).toHaveTextContent("This note link isn’t valid.");
  expect(
    screen.queryByRole("button", { name: "Try again" }),
  ).not.toBeInTheDocument();
  expect(notice).not.toHaveTextContent(
    /orbyn-notes:\/\/|accountId|libraryEpoch|noteId/,
  );
  fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
  expect(dismiss).toHaveBeenCalledTimes(1);
  expect(retry).not.toHaveBeenCalled();
});

it("offers deliberate transport reconnect without promising to reopen a previous note", () => {
  const retry = vi.fn(),
    dismiss = vi.fn();
  render(
    <IncomingNoteLink
      state="service-error"
      onRetry={retry}
      onDismiss={dismiss}
    />,
  );
  const notice = screen.getByRole("alert", { name: "Incoming note link" });
  expect(notice).toHaveTextContent(
    "Note links couldn’t connect. Reconnect, then open the link again.",
  );
  expect(
    screen.queryByRole("button", { name: "Try again" }),
  ).not.toBeInTheDocument();
  expect(retry).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Reconnect" }));
  expect(retry).toHaveBeenCalledTimes(1);
  expect(dismiss).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
  expect(dismiss).toHaveBeenCalledTimes(1);
  expect(notice).not.toHaveTextContent(
    /orbyn-notes:\/\/|accountId|libraryEpoch|noteId/,
  );
});
