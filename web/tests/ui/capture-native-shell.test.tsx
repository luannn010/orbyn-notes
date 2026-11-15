import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { useLayoutEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { DesktopShell, useDesktop } from "../../src/desktop/DesktopShell";
import { QuickNoteWindow } from "../../src/ui/QuickNoteWindow";
import { connectWindow, type DesktopWindow } from "../../src/desktop/window";
import { trackOperation } from "../../src/desktop/closeGuard";
import type { NotesStore } from "../../src/domain/contracts";
vi.mock("../../src/desktop/window", () => ({
  isDesktop: () => true,
  connectWindow: vi.fn(),
}));
vi.mock("../../src/desktop/capture", () => ({
  installQuitGuard: vi.fn(async () => () => {}),
  openQuickNote: vi.fn(),
  showNotes: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),
}));
vi.mock("../../src/ui/RichEditor", () => ({ RichEditor: () => <div /> }));
function bridge(): DesktopWindow {
  return {
    minimize: vi.fn(async () => {}),
    toggleMaximize: vi.fn(async () => {}),
    isMaximized: vi.fn(async () => false),
    close: vi.fn(async () => {}),
    startDragging: vi.fn(async () => {}),
    showSystemMenu: vi.fn(async () => {}),
    finishClose: vi.fn(async () => {}),
    dispose: vi.fn(),
  };
}
beforeEach(() => vi.clearAllMocks());
it("releases the main hide acknowledgment so the same DOM can edit and close again", async () => {
  let close!: (id: number) => void;
  const window = bridge();
  vi.mocked(connectWindow).mockImplementation(async (callback) => {
    close = callback;
    return window;
  });
  render(
    <DesktopShell>
      <input aria-label="Retained input" defaultValue="before" />
    </DesktopShell>,
  );
  const input = await screen.findByLabelText("Retained input");
  await act(async () => close(1));
  expect(window.finishClose).toHaveBeenCalledWith(1);
  expect(document.querySelector(".desktop-shell")).not.toHaveAttribute("inert");
  fireEvent.change(input, { target: { value: "after" } });
  expect(input).toHaveValue("after");
  await expect(trackOperation(async () => "still writable")).resolves.toBe(
    "still writable",
  );
  await act(async () => close(2));
  expect(window.finishClose).toHaveBeenCalledTimes(2);
});
it("ignores Quick close delivered before its bridge resolves without freezing or locking writes", async () => {
  let close!: (id: number) => void, finish!: (value: DesktopWindow) => void;
  const window = bridge();
  vi.mocked(connectWindow).mockImplementation((callback) => {
    close = callback;
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  render(<QuickNoteWindow store={{} as NotesStore} />);
  await act(async () => close(1));
  expect(window.finishClose).not.toHaveBeenCalled();
  expect(document.querySelector(".quick-note-window")).not.toHaveAttribute(
    "inert",
  );
  await expect(trackOperation(async () => true)).resolves.toBe(true);
  await act(async () => finish(window));
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Close Quick note" }),
    ).toBeEnabled(),
  );
  await act(async () => close(1));
  expect(window.finishClose).toHaveBeenCalledWith(1);
});

it("offers an accessible Quit Notes action using the guarded native quit broker", async () => {
  vi.mocked(connectWindow).mockResolvedValue(bridge());
  function WorkspaceChrome() {
    const desktop = useDesktop();
    useLayoutEffect(() => {
      desktop?.setChrome({ title: "All notes", canBack: false, canForward: false,
        back() {}, forward() {}, openSettings() {}, newNote() {} });
      return () => desktop?.setChrome(null);
    }, [desktop?.setChrome]);
    return <div>Library</div>;
  }
  render(<DesktopShell><WorkspaceChrome /></DesktopShell>);
  await screen.findByText("Library");
  fireEvent.click(screen.getByRole("button", { name: "App menu" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "Quit Notes" }));
  expect(invoke).toHaveBeenCalledWith("capture_quit");
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
});
