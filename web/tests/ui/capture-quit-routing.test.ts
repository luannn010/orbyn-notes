import { expect, it, vi } from "vitest";
import { installQuitGuard } from "../../src/desktop/capture";
import { trackOperation } from "../../src/desktop/closeGuard";
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
