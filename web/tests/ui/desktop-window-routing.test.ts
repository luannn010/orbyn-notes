import { readFileSync } from "node:fs";
import { beforeEach, expect, it, vi } from "vitest";
import { connectWindow } from "../../src/desktop/window";
const bus = vi.hoisted(() => ({
  current: "main",
  listeners: new Map<string, (event: { payload: { requestId: number } }) => void>(),
}));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true, invoke: vi.fn(async () => {}) }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => {
  const label = bus.current;
  return {
    // Match the installed SDK's Window.listen target: { kind: "Window", label }.
    listen: vi.fn(async (event: string, handler: (event: { payload: { requestId: number } }) => void) => {
      const key = `${label}:${event}`; bus.listeners.set(key, handler);
      return () => bus.listeners.delete(key);
    }),
    onResized: vi.fn(async () => () => {}),
  };
} }));
beforeEach(() => { bus.listeners.clear(); bus.current = "main"; });
it("routes a native main close only to main and a quick close only to Quick", async () => {
  const mainClose = vi.fn(), quickClose = vi.fn();
  const main = await connectWindow(mainClose, () => {});
  bus.current = "quick-note";
  const quick = await connectWindow(quickClose, () => {});
  bus.listeners.get("main:notes-close-requested")?.({ payload: { requestId: 41 } });
  expect(mainClose).toHaveBeenCalledWith(41); expect(quickClose).not.toHaveBeenCalled();
  bus.listeners.get("quick-note:notes-close-requested")?.({ payload: { requestId: 42 } });
  expect(quickClose).toHaveBeenCalledWith(42); expect(mainClose).toHaveBeenCalledTimes(1);
  bus.listeners.get("quick-note:notes-close-requested")?.({ payload: { requestId: 0 } });
  expect(quickClose).toHaveBeenCalledTimes(1);
  main.dispose(); quick.dispose(); expect(bus.listeners.size).toBe(0);
});
it("native producers target the requesting label, including each quit probe/cancel", () => {
  // Bind the two-window adapter regression to the actual Rust producers: Emitter::emit
  // broadcasts even when called on a Window. Never reintroduce that ambiguous form.
  const main = readFileSync("src-tauri/src/main.rs", "utf8");
  const capture = readFileSync("src-tauri/src/capture.rs", "utf8");
  expect(main).toMatch(/window\.emit_to\(\s*window\.label\(\),\s*"notes-close-requested"/);
  for (const event of ["notes-quit-probe", "notes-quit-cancelled"]) {
    expect(capture).toContain(`window.emit_to(window.label(), "${event}"`);
    expect(capture).not.toContain(`window.emit("${event}"`);
  }
});

it("all native capture creation entries leave synchronous callback threads", () => {
  const source = readFileSync("src-tauri/src/capture.rs", "utf8");
  expect(source).toContain("pub async fn capture_open");
  expect(source).toContain("tauri::async_runtime::spawn_blocking(move || open(&app))");
  expect(source).toContain('"capture" => open_from_event(app)');
  expect(source).toMatch(/if event.state\(\) == ShortcutState::Pressed\s*\{\s*open_from_event\(app\);/);
  expect(source).not.toContain("open(app)");
});
