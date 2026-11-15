// @vitest-environment node
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

it("packages a decoded window PNG and a multi-size Windows executable icon", () => {
  const root = new URL("../../src-tauri/", import.meta.url);
  const config = JSON.parse(readFileSync(new URL("tauri.conf.json", root), "utf8"));
  const pngName = config.bundle.icon.find((name: string) => name.endsWith(".png"));
  const icoName = config.bundle.icon.find((name: string) => name.endsWith(".ico"));
  expect(pngName).toBeTruthy();
  expect(icoName).toBeTruthy();
  const png = readFileSync(new URL(pngName, root));
  expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  expect(png.readUInt32BE(16)).toBeGreaterThanOrEqual(256);
  const ico = readFileSync(new URL(icoName, root));
  expect(ico.readUInt16LE(2)).toBe(1);
  const sizes = Array.from({ length: ico.readUInt16LE(4) }, (_, index) => ico[6 + index * 16] || 256);
  expect(sizes).toEqual(expect.arrayContaining([16, 32, 48, 256]));
});
