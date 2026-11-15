import { expect, it, vi } from "vitest";
import { installQuitGuard } from "../../src/desktop/capture";
import { invoke } from "@tauri-apps/api/core";
import { registerCloseGuard, trackOperation } from "../../src/desktop/closeGuard";
const bus = vi.hoisted(() => ({
  listeners: new Map<string, (event: { payload: string }) => void>(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => {}), isTauri: () => true }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async (event: string, handler: (event: { payload: string }) => void) => {
  bus.listeners.set(event, handler); return () => bus.listeners.delete(event);
}) }));
it("a targeted quit probe freezes once and denial cancellation releases the window for another quit", async () => {
  const root = document.createElement("div"), blocked = vi.fn();
  const dispose = await installQuitGuard(root, blocked);
  bus.listeners.get("notes-quit-probe")?.({ payload: "first" });
  expect(root.inert).toBe(true);
  await expect(trackOperation(async () => {})).rejects.toThrow("closing");
  bus.listeners.get("notes-quit-cancelled")?.({ payload: "first" });
  expect(root.inert).toBe(false); expect(blocked).toHaveBeenCalledOnce();
  await expect(trackOperation(async () => "editable")).resolves.toBe("editable");
  bus.listeners.get("notes-quit-probe")?.({ payload: "second" });
  expect(root.inert).toBe(true);
  dispose(); expect(root.inert).toBe(false); expect(bus.listeners.size).toBe(0);
  await expect(trackOperation(async () => "recovered")).resolves.toBe("recovered");
});

it("late cancel A cannot release quit B or overwrite its original inert baseline", async () => {
  const root = document.createElement("div"), blocked = vi.fn();
  const dispose = await installQuitGuard(root, blocked);
  try {
    bus.listeners.get("notes-quit-probe")?.({ payload: "A" });
    bus.listeners.get("notes-quit-probe")?.({ payload: "B" });
    bus.listeners.get("notes-quit-cancelled")?.({ payload: "A" });
    expect(root.inert).toBe(true);
    await expect(trackOperation(async () => {})).rejects.toThrow("closing");
    expect(blocked).not.toHaveBeenCalled();
    bus.listeners.get("notes-quit-cancelled")?.({ payload: "B" });
    expect(root.inert).toBe(false);
    await expect(trackOperation(async () => "editable")).resolves.toBe("editable");
    expect(blocked).toHaveBeenCalledOnce();
  } finally { dispose(); }
});
it("obsolete A reply rejection cannot release B; matching B rejection releases it", async () => {
  let rejectA!: (error: Error) => void, rejectB!: (error: Error) => void;
  vi.mocked(invoke).mockImplementationOnce(() => new Promise((_, reject) => { rejectA = reject; }))
    .mockImplementationOnce(() => new Promise((_, reject) => { rejectB = reject; }));
  const root = document.createElement("div"), blocked = vi.fn();
  const dispose = await installQuitGuard(root, blocked);
  try {
    bus.listeners.get("notes-quit-probe")?.({ payload: "A" });
    bus.listeners.get("notes-quit-probe")?.({ payload: "B" });
    rejectA(new Error("A expired")); await Promise.resolve();
    expect(root.inert).toBe(true);
    await expect(trackOperation(async () => {})).rejects.toThrow("closing");
    expect(blocked).not.toHaveBeenCalled();
    rejectB(new Error("B failed")); await Promise.resolve();
    expect(root.inert).toBe(false);
    expect(blocked).toHaveBeenCalledOnce();
    await expect(trackOperation(async () => "editable")).resolves.toBe("editable");
  } finally { dispose(); }
});
it("blocked replacement probe releases previous freeze; cancellation remains token bound", async () => {
  const root = document.createElement("div"), blocked = vi.fn();
  const dispose = await installQuitGuard(root, blocked);
  let removeGuard = () => {};
  try {
    bus.listeners.get("notes-quit-probe")?.({ payload: "A" });
    removeGuard = registerCloseGuard(() => false);
    bus.listeners.get("notes-quit-probe")?.({ payload: "B" });
    expect(root.inert).toBe(false);
    expect(invoke).toHaveBeenLastCalledWith("capture_quit_reply", { token: "B", allowed: false });
    bus.listeners.get("notes-quit-cancelled")?.({ payload: "A" });
    expect(blocked).toHaveBeenCalledOnce();
    bus.listeners.get("notes-quit-cancelled")?.({ payload: "B" });
    expect(blocked).toHaveBeenCalledTimes(2);
    await expect(trackOperation(async () => "editable")).resolves.toBe("editable");
  } finally { removeGuard(); dispose(); }
});
it("disposal restores original inert state and fences pending reply rejection", async () => {
  let reject!: (error: Error) => void;
  vi.mocked(invoke).mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; }));
  const root = document.createElement("div"), blocked = vi.fn();
  root.inert = true;
  const dispose = await installQuitGuard(root, blocked);
  bus.listeners.get("notes-quit-probe")?.({ payload: "A" });
  dispose(); reject(new Error("late")); await Promise.resolve();
  expect(root.inert).toBe(true);
  expect(blocked).not.toHaveBeenCalled();
  expect(bus.listeners.size).toBe(0);
  await expect(trackOperation(async () => "editable")).resolves.toBe("editable");
});
