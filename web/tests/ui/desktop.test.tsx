import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DesktopShell } from "../../src/desktop/DesktopShell";
import { registerCloseGuard, trackOperation, protectOperations, checkClose } from "../../src/desktop/closeGuard";
import { connectWindow, isDesktop, type DesktopWindow } from "../../src/desktop/window";

vi.mock("../../src/desktop/window", () => ({ isDesktop: vi.fn(), connectWindow: vi.fn() }));
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function windowMock(): DesktopWindow {
  return { minimize: vi.fn(async () => {}), toggleMaximize: vi.fn(async () => {}), isMaximized: vi.fn(async () => false), close: vi.fn(async () => {}), startDragging: vi.fn(async () => {}), showSystemMenu: vi.fn(async () => {}), finishClose: vi.fn(async () => {}), dispose: vi.fn() };
}
beforeEach(() => { vi.resetAllMocks(); });
describe("desktop window", () => {
  it("renders browser children without connecting", () => {
    vi.mocked(isDesktop).mockReturnValue(false);
    render(<DesktopShell><button>Content</button></DesktopShell>);
    expect(screen.getByText("Content")).toBeEnabled();
    expect(connectWindow).not.toHaveBeenCalled();
  });
  it("waits for the listener and recovers a registration failure", async () => {
    vi.mocked(isDesktop).mockReturnValue(true);
    const first = deferred<DesktopWindow>();
    vi.mocked(connectWindow).mockReturnValueOnce(first.promise).mockResolvedValueOnce(windowMock());
    render(<DesktopShell><button>Content</button></DesktopShell>);
    expect(screen.queryByText("Content")).not.toBeInTheDocument();
    await act(async () => first.reject(new Error("listener")));
    expect(screen.queryByText("Content")).not.toBeInTheDocument();
    expect(screen.getByText("Window controls aren’t available. Try again.")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Content")).toBeEnabled();
  });
  it("disposes a connection that arrives after unmount", async () => {
    vi.mocked(isDesktop).mockReturnValue(true);
    const pending = deferred<DesktopWindow>(); const window = windowMock();
    vi.mocked(connectWindow).mockReturnValue(pending.promise);
    const view = render(<DesktopShell>Content</DesktopShell>);
    view.unmount();
    await act(async () => pending.resolve(window));
    expect(window.dispose).toHaveBeenCalledOnce();
  });
  it("uses native controls and updates maximize state from the window", async () => {
    vi.mocked(isDesktop).mockReturnValue(true);
    const window = windowMock(); let resized!: () => void;
    const pending = deferred<DesktopWindow>();
    vi.mocked(connectWindow).mockImplementation((_close, resize) => { resized = resize; return pending.promise; });
    render(<DesktopShell>Content</DesktopShell>);
    const minimize = screen.getByRole("button", { name: "Minimize window" });
    expect(minimize).toBeDisabled();
    fireEvent.click(minimize);
    expect(window.minimize).not.toHaveBeenCalled();
    await act(async () => pending.resolve(window));
    await waitFor(() => expect(minimize).toBeEnabled());
    fireEvent.click(minimize);
    fireEvent.click(screen.getByRole("button", { name: "Maximize window" }));
    fireEvent.click(screen.getByRole("button", { name: "Close window" }));
    expect(window.minimize).toHaveBeenCalledOnce(); expect(window.toggleMaximize).toHaveBeenCalledOnce(); expect(window.close).toHaveBeenCalledOnce();
    vi.mocked(window.isMaximized).mockResolvedValue(true);
    await act(async () => resized());
    expect(await screen.findByRole("button", { name: "Restore window" })).toBeEnabled();
  });
  it("drags passive toolbar space while keeping caption controls interactive", async () => {
    vi.mocked(isDesktop).mockReturnValue(true);
    const window = windowMock();
    vi.mocked(connectWindow).mockResolvedValue(window);
    render(<DesktopShell>Content</DesktopShell>);
    await screen.findByText("Content");
    fireEvent.mouseDown(screen.getByText("Orbyn Notes"), { button: 0, detail: 1 });
    expect(window.startDragging).toHaveBeenCalledOnce();
    fireEvent.mouseDown(screen.getByRole("button", { name: "Close window" }), { button: 0, detail: 1 });
    expect(window.startDragging).toHaveBeenCalledOnce();
    fireEvent.mouseDown(screen.getByText("Orbyn Notes"), { button: 0, detail: 2 });
    expect(window.toggleMaximize).toHaveBeenCalledOnce();
  });
  it("blocks guarded and pending work without replaying the close", async () => {
    vi.mocked(isDesktop).mockReturnValue(true); const window = windowMock(); let close!: (id: number) => void;
    vi.mocked(connectWindow).mockImplementation(async callback => { close = callback; return window; });
    render(<DesktopShell>Content</DesktopShell>); await screen.findByText("Content");
    const remove = registerCloseGuard(() => false);
    act(() => close(1)); expect(window.finishClose).not.toHaveBeenCalled(); remove();
    const pending = deferred<void>(); const operation = trackOperation(() => pending.promise);
    act(() => close(2)); expect(window.finishClose).not.toHaveBeenCalled();
    expect(screen.getByText("Notes is still working. Wait for it to finish before closing.")).toBeVisible();
    await act(async () => { pending.resolve(); await operation; });
    expect(window.finishClose).not.toHaveBeenCalled();
    act(() => close(3)); expect(window.finishClose).toHaveBeenCalledWith(3);
  });
  it("freezes the whole root before finishing and unfreezes after failure", async () => {
    vi.mocked(isDesktop).mockReturnValue(true); const window = windowMock(); let close!: (id: number) => void;
    const pending = deferred<void>();
    vi.mocked(window.finishClose).mockImplementation(() => { expect(document.querySelector(".desktop-shell")).toHaveProperty("inert", true); return pending.promise; });
    vi.mocked(connectWindow).mockImplementation(async callback => { close = callback; return window; });
    render(<DesktopShell><button>Content</button></DesktopShell>); await screen.findByText("Content");
    act(() => close(7)); expect(window.finishClose).toHaveBeenCalledWith(7);
    await act(async () => pending.reject(new Error("invoke")));
    expect(document.querySelector(".desktop-shell")).toHaveProperty("inert", false);
    expect(screen.getByText("Window controls aren’t available. Try again.")).toBeVisible();
  });
});
it("protects receiver and waits for concurrent account operations even when one rejects", async () => {
  const first = deferred<string>(); const second = deferred<string>();
  const service = { prefix: "account", signout(this: { prefix: string }, task: Promise<string>) { expect(this.prefix).toBe("account"); return task; } };
  const protectedService = protectOperations(service, ["signout"]);
  const a = protectedService.signout(first.promise); const b = protectedService.signout(second.promise);
  expect(checkClose()).toBe("working");
  first.resolve("done"); expect(await a).toBe("done"); expect(checkClose()).toBe("working");
  const failure = expect(b).rejects.toThrow("failed"); second.reject(new Error("failed")); await failure;
  expect(checkClose()).toBe("allowed");
});
