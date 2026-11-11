import { expect, it, vi } from "vitest";
import { freezeWindow } from "../../src/desktop/freeze";
import { lockClosing, trackOperation } from "../../src/desktop/closeGuard";

it("freezes modal elements, including late dialogs, and restores their previous state", async () => {
  const root = document.createElement("div");
  const dialog = document.createElement("dialog");
  root.inert = false;
  dialog.inert = false;
  root.append(dialog);
  document.body.append(root);
  const restore = freezeWindow(root);
  const late = document.createElement("dialog");
  late.inert = true;
  root.append(late);
  await Promise.resolve();
  expect(root.inert).toBe(true);
  expect(dialog.inert).toBe(true);
  expect(late.inert).toBe(true);
  restore();
  expect(root.inert).toBe(false);
  expect(dialog.inert).toBe(false);
  expect(late.inert).toBe(true);
  root.remove();
});

it("does not admit a late write after close approval, and permits retry after close fails", async () => {
  const write = vi.fn(async () => "committed");
  const unlock = lockClosing();
  try {
    await expect(trackOperation(write)).rejects.toThrow("window is closing");
    expect(write).not.toHaveBeenCalled();
  } finally { unlock(); }
  await expect(trackOperation(write)).resolves.toBe("committed");
  expect(write).toHaveBeenCalledOnce();
});
