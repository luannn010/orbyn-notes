import { StrictMode, useEffect } from "react";
import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import type { NoteTarget } from "../../src/links/contracts";
import { useIncomingNoteLink } from "../../src/links/useIncomingNoteLink";
import { encodeNoteReference } from "../../src/links/reference";

const native = vi.hoisted(() => ({
  start: vi.fn(),
  retire: vi.fn(),
  handoff: null as null | ((target: NoteTarget, sequence: number) => boolean),
  invalid: null as null | (() => void),
  error: null as null | (() => void),
}));
vi.mock("../../src/desktop/noteLinks", () => ({
  nativeNoteLinkIngress: native,
}));
const target: NoteTarget = {
  kind: "note",
  accountId: "11111111-1111-4111-8111-111111111111",
  libraryEpoch: "22222222-2222-4222-8222-222222222222",
  noteId: "native",
};
const owner = {};
const navigate = vi.fn();
function Harness({ desktop = true }: { desktop?: boolean }) {
  const incoming = useIncomingNoteLink(owner, desktop);
  useEffect(() => {
    incoming.register(navigate);
    return () => incoming.register(null);
  }, [incoming.register]);
  return (
    <>
      <p role="status">{incoming.state ?? "none"}</p>
      <button onClick={incoming.revoke}>Revoke</button>
      <button onClick={incoming.retry}>Retry</button>
      <button onClick={incoming.dismiss}>Dismiss</button>
      <p>{incoming.format ? "Web format" : "Local reference fallback"}</p>
    </>
  );
}
beforeEach(() => {
  native.start
    .mockReset()
    .mockImplementation(async (handoff, invalid, error) => {
      native.handoff = handoff;
      native.invalid = invalid;
      native.error = error;
    });
  native.retire.mockReset().mockResolvedValue(undefined);
  native.handoff = null;
  native.invalid = null;
  native.error = null;
  navigate.mockReset().mockResolvedValue({ status: "opened" });
  window.history.replaceState(null, "", "/");
});
it("notifies React about a valid pre-workspace intent whose visible status stays null", () => {
  const hash = "#note/v1/" + encodeNoteReference(target).split("/v1/")[1];
  window.history.replaceState(null, "", "/" + hash);
  const { result } = renderHook(() => useIncomingNoteLink(null, false));
  expect(result.current.state).toBe(null);
  expect(result.current.hasPending).toBe(true);
  act(() => result.current.revoke());
  expect(result.current.hasPending).toBe(false);
});
it("hands native targets to the shared navigator and keeps local-reference copy until association is qualified", async () => {
  render(
    <StrictMode>
      <Harness />
    </StrictMode>,
  );
  await waitFor(() => expect(native.handoff).not.toBeNull());
  // The StrictMode second setup uses the same consumer and must not retire the
  // startup pending URI. At most a previous test's distinct consumer retires.
  expect(native.retire.mock.calls.length).toBeLessThanOrEqual(1);
  act(() => {
    expect(native.handoff?.(target, 1)).toBe(true);
  });
  await waitFor(() =>
    expect(navigate).toHaveBeenCalledExactlyOnceWith(
      target,
      expect.any(AbortSignal),
    ),
  );
  expect(screen.getByText("Local reference fallback")).toBeVisible();
});
it("does not start native IPC in the web app", async () => {
  render(<Harness desktop={false} />);
  await act(async () => {});
  expect(native.start).not.toHaveBeenCalled();
  expect(native.retire).not.toHaveBeenCalled();
  expect(screen.getByText("Web format")).toBeVisible();
});
it.each(["opened", "blocked"] as const)(
  "clears an older transport error when a newer activation is %s",
  async (status) => {
    navigate.mockResolvedValue({ status });
    render(<Harness />);
    await waitFor(() => expect(native.handoff).not.toBeNull());
    act(() => native.error?.());
    expect(screen.getByRole("status")).toHaveTextContent("service-error");
    act(() => {
      native.handoff?.(target, 10);
    });
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        status === "opened" ? "none" : "blocked",
      ),
    );
    act(() => native.error?.());
    act(() => native.invalid?.());
    expect(screen.getByRole("status")).toHaveTextContent("invalid");
  },
);
it("ignores an older connection failure after an explicit reconnect succeeds", async () => {
  let rejectOld!: (error: Error) => void;
  native.start.mockImplementationOnce((handoff, invalid, error) => {
    native.handoff = handoff;
    native.invalid = invalid;
    native.error = error;
    return new Promise<void>((_resolve, reject) => {
      rejectOld = reject;
    });
  });
  render(<Harness />);
  await waitFor(() => expect(native.error).not.toBeNull());
  act(() => native.error?.());
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await waitFor(() =>
    expect(screen.getByRole("status")).toHaveTextContent("none"),
  );
  await act(async () => {
    rejectOld(new Error("Older listener failed"));
  });
  expect(screen.getByRole("status")).toHaveTextContent("none");
});
it("retires native pending delivery synchronously on active scope revocation and does not retry blocked notes", async () => {
  navigate.mockResolvedValue({ status: "blocked" });
  render(<Harness />);
  await waitFor(() => expect(native.handoff).not.toBeNull());
  act(() => {
    native.handoff?.(target, 2);
  });
  await waitFor(() =>
    expect(screen.getByRole("status")).toHaveTextContent("blocked"),
  );
  const before = native.retire.mock.calls.length;
  fireEvent.click(screen.getByRole("button", { name: "Revoke" }));
  expect(native.retire.mock.calls.length).toBe(before + 1);
  expect(screen.getByRole("status")).toHaveTextContent("none");
  await act(async () => {});
  expect(navigate).toHaveBeenCalledTimes(1);
});
it("shows invalid versus transport failure separately and reconnects without reopening a stale target", async () => {
  render(<Harness />);
  await waitFor(() => expect(native.handoff).not.toBeNull());
  act(() => native.invalid?.());
  expect(screen.getByRole("status")).toHaveTextContent("invalid");
  fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
  act(() => native.error?.());
  expect(screen.getByRole("status")).toHaveTextContent("service-error");
  const before = native.retire.mock.calls.length;
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await waitFor(() =>
    expect(screen.getByRole("status")).toHaveTextContent("none"),
  );
  expect(native.retire.mock.calls.length).toBe(before + 1);
  expect(navigate).not.toHaveBeenCalled();
});
it("rejects delivery to an unmounted consumer and retires before handing a pending URI to a different consumer", async () => {
  const first = render(<Harness />);
  await waitFor(() => expect(native.handoff).not.toBeNull());
  const oldHandoff = native.handoff!;
  first.unmount();
  expect(oldHandoff(target, 3)).toBe(false);
  const before = native.retire.mock.calls.length;
  render(<Harness />);
  await waitFor(() => expect(native.retire.mock.calls.length).toBe(before + 1));
  expect(navigate).not.toHaveBeenCalled();
});
