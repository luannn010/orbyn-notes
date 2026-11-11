import { StrictMode, useEffect } from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import type { AccountSession } from "../../src/domain/contracts";
import type {
  NoteLinkCopyFormatter,
  NoteLinkNavigatorRegistration,
} from "../../src/links/navigation";
import { encodeNoteReference } from "../../src/links/reference";

const fixture = vi.hoisted(() => ({
  session: null as AccountSession | null,
  lock: null as (() => void) | null,
  navigate: vi.fn(),
  format: undefined as NoteLinkCopyFormatter | undefined,
}));
const session: AccountSession = {
  accountId: "11111111-1111-4111-8111-111111111111",
  deviceId: "device",
  email: "fixture@example.invalid",
  deviceState: "trusted",
};
const target = {
  kind: "note" as const,
  accountId: session.accountId,
  libraryEpoch: "22222222-2222-4222-8222-222222222222",
  noteId: "one",
};
function setHash(hash: string) {
  window.history.replaceState(null, "", "/?invite=not-for-clipboard" + hash);
  window.dispatchEvent(new HashChangeEvent("hashchange"));
}
const hash = () => "#note/v1/" + encodeNoteReference(target).split("/v1/")[1];
vi.mock("../../src/account", () => ({
  createAccountService: () => ({
    current: async () => fixture.session,
    signOut: async () => {
      fixture.lock?.();
    },
  }),
  subscribeLock: (listener: () => void) => {
    fixture.lock = listener;
    return () => {
      fixture.lock = null;
    };
  },
}));
vi.mock("../../src/data", () => ({
  openNotesStore: async () => ({ close: vi.fn() }),
}));
vi.mock("../../src/ui/Workspace", () => ({
  Workspace: ({
    onNoteLinkNavigatorReady,
    formatNoteLink,
  }: {
    onNoteLinkNavigatorReady: NoteLinkNavigatorRegistration;
    formatNoteLink: NoteLinkCopyFormatter;
  }) => {
    fixture.format = formatNoteLink;
    useEffect(() => {
      onNoteLinkNavigatorReady(fixture.navigate);
      return () => onNoteLinkNavigatorReady(null);
    }, [onNoteLinkNavigatorReady]);
    return <p>Workspace fixture</p>;
  },
}));
vi.mock("../../src/ui/AccountView", () => ({
  AccountView: ({
    onSession,
  }: {
    onSession: (session: AccountSession) => void;
  }) => (
    <button
      onClick={() => {
        fixture.lock?.();
        onSession(session);
      }}
    >
      Fixture sign in
    </button>
  ),
  PendingDevice: () => <p>Pending fixture</p>,
}));
import { App } from "../../src/App";
beforeEach(() => {
  fixture.session = null;
  fixture.navigate.mockReset().mockResolvedValue({ status: "opened" });
  fixture.format = undefined;
  vi.stubEnv("VITE_ENGINE_URL", "http://127.0.0.1:8089");
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  window.history.replaceState(null, "", "/");
});
it("reports an invalid incoming link before sign-in without attempting private navigation", async () => {
  setHash("#note/v2/not-valid");
  render(<App />);
  expect(
    await screen.findByRole("button", { name: "Fixture sign in" }),
  ).toBeVisible();
  expect(await screen.findByText("This note link isn’t valid.")).toBeVisible();
  expect(fixture.navigate).not.toHaveBeenCalled();
});

it("holds the initial URL through actual App sign-in wiring and supplies a query-free web link", async () => {
  setHash(hash());
  render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
  fireEvent.click(
    await screen.findByRole("button", { name: "Fixture sign in" }),
  );
  await screen.findByText("Workspace fixture");
  await waitFor(() =>
    expect(fixture.navigate).toHaveBeenCalledExactlyOnceWith(
      target,
      expect.any(AbortSignal),
    ),
  );
  expect(fixture.format?.(target)).toEqual({
    text: window.location.origin + "/" + hash(),
    kind: "web-link",
  });
  await waitFor(() =>
    expect(
      screen.queryByLabelText("Incoming note link"),
    ).not.toBeInTheDocument(),
  );
});

it("requires explicit retry after guarded blocking and revokes the old URL on lock", async () => {
  fixture.session = session;
  fixture.navigate
    .mockResolvedValueOnce({ status: "blocked" })
    .mockResolvedValue({ status: "opened" });
  setHash(hash());
  render(<App />);
  await screen.findByText("Finish your current work before opening this note.");
  expect(fixture.navigate).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  await waitFor(() => expect(fixture.navigate).toHaveBeenCalledTimes(2));
  act(() => fixture.lock?.());
  expect(screen.queryByText("Workspace fixture")).not.toBeInTheDocument();
  expect(window.location.hash).toBe("");
  fireEvent.click(screen.getByRole("button", { name: "Fixture sign in" }));
  await screen.findByText("Workspace fixture");
  expect(fixture.navigate).toHaveBeenCalledTimes(2);
});

it("aborts an in-flight intent when the hash changes and never puts private identity into notices", async () => {
  fixture.session = session;
  let admitted: AbortSignal | undefined;
  fixture.navigate.mockImplementation((_target, signal) => {
    admitted = signal;
    return new Promise(() => {});
  });
  setHash(hash());
  render(<App />);
  await waitFor(() => expect(fixture.navigate).toHaveBeenCalledTimes(1));
  act(() => setHash("#note/v9/not-valid"));
  expect(admitted?.aborted).toBe(true);
  expect(await screen.findByText("This note link isn’t valid.")).toBeVisible();
  expect(screen.getByLabelText("Incoming note link")).not.toHaveTextContent(
    target.accountId,
  );
  fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
  expect(window.location.hash).toBe("");
});
