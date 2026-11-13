import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { readEnginePatch } from "./engine-source.mjs";
const root = new URL("../", import.meta.url);
const pin = JSON.parse(
  await readFile(new URL("engine-pin.json", root), "utf8"),
);
await readEnginePatch(fileURLToPath(root), pin);
const required = [
  "orbyn_wasm.js",
  "orbyn_wasm.d.ts",
  "orbyn_wasm_bg.wasm",
  "orbyn_wasm_bg.wasm.d.ts",
].sort();
if (JSON.stringify(Object.keys(pin.sha256).sort()) !== JSON.stringify(required))
  throw new Error("Engine pin must cover all four runtime artifacts.");
for (const [name, expected] of Object.entries(pin.sha256)) {
  const actual = createHash("sha256")
    .update(await readFile(new URL(`src/generated/wasm/${name}`, root)))
    .digest("hex");
  if (actual !== expected)
    throw new Error(`Engine artifact hash mismatch: ${name}`);
}
console.log(
  `Verified engine ${pin.engineCommit}${pin.enginePatch ? ` + patch ${pin.enginePatch.sha256.slice(0, 12)}` : ""}: ${Object.keys(pin.sha256).length} artifacts`,
);
