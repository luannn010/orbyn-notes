import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const root = new URL("../", import.meta.url);
const pin = JSON.parse(
  await readFile(new URL("engine-pin.json", root), "utf8"),
);
for (const [name, expected] of Object.entries(pin.sha256)) {
  const actual = createHash("sha256")
    .update(await readFile(new URL(`src/generated/wasm/${name}`, root)))
    .digest("hex");
  if (actual !== expected)
    throw new Error(`Engine artifact hash mismatch: ${name}`);
}
console.log(
  `Verified engine ${pin.engineCommit}: ${Object.keys(pin.sha256).length} artifacts`,
);
