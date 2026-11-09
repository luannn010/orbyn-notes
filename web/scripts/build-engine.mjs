import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
const root = new URL("../", import.meta.url);
const pin = JSON.parse(
  await readFile(new URL("engine-pin.json", root), "utf8"),
);
const source = process.argv[2];
if (!source)
  throw new Error(
    "Usage: node scripts/build-engine.mjs <pinned-engine-checkout> (requires Cargo and matching wasm-bindgen).",
  );
const check = spawnSync("git", ["rev-parse", "HEAD"], {
  cwd: source,
  encoding: "utf8",
});
if (check.status !== 0 || check.stdout.trim() !== pin.engineCommit)
  throw new Error("Engine checkout must match engine-pin.json.");
for (const [command, args] of [
  [
    "cargo",
    [
      "build",
      "--locked",
      "-p",
      "orbyn-wasm",
      "--release",
      "--target",
      "wasm32-unknown-unknown",
    ],
  ],
  [
    "wasm-bindgen",
    [
      "--target",
      "web",
      "--out-dir",
      fileURLToPath(new URL("src/generated/wasm/", root)),
      "target/wasm32-unknown-unknown/release/orbyn_wasm.wasm",
    ],
  ],
]) {
  const result = spawnSync(command, args, { cwd: source, stdio: "inherit" });
  if (result.error || result.status !== 0)
    throw new Error(
      `${command} failed; verify installed Rust target and the wasm-bindgen version in Cargo.lock.`,
    );
}
console.log(
  "Built engine artifacts. Review the generated diff and update verified hashes deliberately; do not assume byte-for-byte reproducibility across Rust versions.",
);
