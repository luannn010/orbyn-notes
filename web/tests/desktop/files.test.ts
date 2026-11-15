import { beforeEach, describe, expect, it, vi } from "vitest";
const { invoke, isTauri } = vi.hoisted(() => ({ invoke: vi.fn(), isTauri: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke, isTauri }));
import { saveDesktopFile } from "../../src/desktop/files";

describe("native export", () => {
  beforeEach(() => { invoke.mockReset(); isTauri.mockReturnValue(true); });
  it("writes bytes after confirming the selected destination", async () => {
    invoke.mockResolvedValueOnce("token").mockResolvedValue(undefined);
    const confirm = vi.fn(() => { expect(invoke).toHaveBeenCalledTimes(1); });
    expect(await saveDesktopFile("notes.zip", new Blob([new Uint8Array([0, 255])]), confirm)).toBe(true);
    expect(invoke).toHaveBeenNthCalledWith(2, "write_export", { token: "token", bytes: [0, 255] });
    expect(invoke).toHaveBeenNthCalledWith(3, "discard_export", { token: "token" });
  });
  it("discards an invalidated selection", async () => {
    invoke.mockResolvedValueOnce("token").mockResolvedValue(undefined);
    await expect(saveDesktopFile("notes.txt", new Blob(["x"]), () => { throw new Error("changed"); })).rejects.toThrow("changed");
    expect(invoke).toHaveBeenLastCalledWith("discard_export", { token: "token" });
    expect(invoke).not.toHaveBeenCalledWith("write_export", expect.anything());
  });
  it("returns false on cancellation", async () => {
    invoke.mockResolvedValueOnce(null);
    expect(await saveDesktopFile("notes.txt", new Blob(["x"]))).toBe(false);
    expect(invoke).toHaveBeenCalledTimes(1);
  });
});
