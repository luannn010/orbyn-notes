import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { resolve, join } from "node:path";
import { homedir } from "node:os";
import { verifyEngineSource } from "./engine-source.mjs";
export async function buildEngine({
  source,
  root,
  pin,
  environment = process.env,
  run = spawnSync,
}) {
  await verifyEngineSource(source, root, pin);
  const bindgen = environment.ORBYN_WASM_BINDGEN ?? "wasm-bindgen";
  const cargo = environment.ORBYN_CARGO ?? "cargo";
  const compiler = environment.ORBYN_RUSTC ?? environment.RUSTC ?? "rustc";
  if (environment.RUSTC_WRAPPER || environment.RUSTC_WORKSPACE_WRAPPER)
    throw new Error("Engine build does not accept compiler wrappers.");
  // Cargo gives encoded flags priority over other environment flags. Refuse
  // ambiguous inputs instead of silently changing caller-supplied build options.
  for (const [key, value] of Object.entries(environment)) {
    if (
      value &&
      (key === "RUSTFLAGS" ||
        key === "CARGO_ENCODED_RUSTFLAGS" ||
        key === "CARGO_BUILD_RUSTFLAGS" ||
        /^CARGO_TARGET_.+_RUSTFLAGS$/.test(key))
    )
      throw new Error(
        "Engine build does not accept externally supplied Rust flags.",
      );
  }
  const userHome = environment.USERPROFILE || environment.HOME || homedir();
  const roots = [
    [
      resolve(source, environment.CARGO_HOME || join(userHome, ".cargo")),
      "/orbyn-build/cargo",
    ],
    [
      resolve(source, environment.RUSTUP_HOME || join(userHome, ".rustup")),
      "/orbyn-build/rustup",
    ],
    [resolve(source), "/orbyn-build/engine"],
  ];
  const remaps = [];
  for (const [path, replacement] of roots) {
    if (/[=\x1f]/.test(path))
      throw new Error(
        "Engine build paths cannot contain '=' or the flags separator.",
      );
    for (const spelling of new Set([path, path.replaceAll("\\", "/")]))
      remaps.push(`--remap-path-prefix=${spelling}=${replacement}`);
  }
  // Cargo must receive the same compiler that was checked, regardless of its own toolchain selection.
  const env = {
    ...environment,
    RUSTC: compiler,
    CARGO_ENCODED_RUSTFLAGS: remaps.join("\x1f"),
  };
  if (pin.build) {
    for (const [command, expected] of [
      [bindgen, `wasm-bindgen ${pin.build.wasmBindgen}`],
      [compiler, pin.build.rustc],
    ]) {
      const result = run(command, ["--version"], {
        cwd: source,
        encoding: "utf8",
        env,
      });
      if (
        result.error ||
        result.status !== 0 ||
        result.stdout.trim() !== expected
      )
        throw new Error("Engine build tool version differs from reviewed pin.");
    }
  }
  const target = environment.CARGO_TARGET_DIR
    ? resolve(source, environment.CARGO_TARGET_DIR)
    : resolve(source, "target");
  for (const [command, args] of [
    [
      cargo,
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
      bindgen,
      [
        "--target",
        "web",
        "--out-dir",
        resolve(root, "src/generated/wasm"),
        resolve(target, "wasm32-unknown-unknown/release/orbyn_wasm.wasm"),
      ],
    ],
  ]) {
    const result = run(command, args, { cwd: source, stdio: "inherit", env });
    if (result.error || result.status !== 0)
      throw new Error(
        `${command} failed; verify installed Rust target and the wasm-bindgen version in Cargo.lock.`,
      );
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const pin = JSON.parse(
    await readFile(resolve(root, "engine-pin.json"), "utf8"),
  );
  const source = process.argv[2];
  if (!source)
    throw new Error(
      "Usage: node scripts/build-engine.mjs <pinned-engine-checkout> (requires Cargo and matching wasm-bindgen).",
    );
  await buildEngine({ source, root, pin });
  console.log(
    "Built engine artifacts. Review the generated diff and update verified hashes deliberately; do not assume byte-for-byte reproducibility across Rust versions.",
  );
}
