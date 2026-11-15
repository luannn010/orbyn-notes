import { useState } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { QuickNoteWindow } from "../../src/ui/QuickNoteWindow";
import type { NotesStore } from "../../src/domain/contracts";
const native = vi.hoisted(() => ({
  result: null as
    null | ((event: { payload: { token: string; accepted: boolean } }) => void),
  requests: [] as { token: string; reject: (error: Error) => void }[],
  close: vi.fn(async () => {}),
}));
vi.mock("../../src/desktop/window", () => ({
  isDesktop: () => true,
  connectWindow: async () => ({
    minimize: async () => {},
    toggleMaximize: async () => {},
    isMaximized: async () => false,
    close: native.close,
    startDragging: async () => {},
    showSystemMenu: async () => {},
    finishClose: async () => {},
    dispose: () => {},
  }),
}));
vi.mock("../../src/desktop/capture", () => ({
  installQuitGuard: async () => () => {},
  showNotes: vi.fn(),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: async (name: string, handler: typeof native.result) => {
    if (name === "notes-capture-result") native.result = handler;
    return () => {};
  },
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (command: string, args: { token: string }) =>
    command === "capture_handoff"
      ? new Promise((_resolve, reject) =>
          native.requests.push({ token: args.token, reject }),
        )
      : Promise.resolve(null),
}));
vi.mock("../../src/ui/NewNote", () => ({
  NewNote: ({ onOpen }: { onOpen: (note: unknown) => Promise<void> }) => {
    const [result, setResult] = useState("");
    return (
      <>
        <button
          onClick={() =>
            void onOpen({ id: "11111111-1111-4111-8111-111111111111" })
              .then(() => setResult("accepted"))
              .catch(() => setResult("timed out"))
          }
        >
          Request handoff
        </button>
        <output>{result}</output>
      </>
    );
  },
}));
afterEach(() => vi.useRealTimers());
it("drops an already-emitted late R1 result and late invocation rejection while R2 is pending, including event-before-response", async () => {
  native.requests = [];
  native.result = null;
  native.close.mockClear();
  render(<QuickNoteWindow store={{} as NotesStore} />);
  await screen.findByRole("button", { name: "Request handoff" });
  vi.useFakeTimers();
  fireEvent.click(screen.getByRole("button", { name: "Request handoff" }));
  const first = native.requests[0]!;
  await act(async () => vi.advanceTimersByTimeAsync(5000));
  expect(screen.getByText("timed out")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Request handoff" }));
  const second = native.requests[1]!;
  expect(second.token).not.toBe(first.token);
  await act(async () =>
    native.result?.({ payload: { token: first.token, accepted: true } }),
  );
  expect(native.close).not.toHaveBeenCalled();
  await act(async () =>
    first.reject(new Error("late native transport failure")),
  );
  expect(native.close).not.toHaveBeenCalled();
  await act(async () =>
    native.result?.({ payload: { token: second.token, accepted: true } }),
  );
  expect(native.close).toHaveBeenCalledOnce();
  expect(screen.getByText("accepted")).toBeVisible();
});
