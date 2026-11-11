import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform !== "win32") throw new Error("This build entry point requires Windows.");
const web = fileURLToPath(new URL("../", import.meta.url));
const cargoBin = join(homedir(), ".cargo", "bin");
if (!existsSync(join(cargoBin, "cargo.exe"))) throw new Error("Install the Rust MSVC toolchain before building.");
const engine = process.env.VITE_ENGINE_URL ?? "http://127.0.0.1:8089";
if (engine !== "http://127.0.0.1:8089") {
  throw new Error("The desktop CSP permits only http://127.0.0.1:8089; review it before changing the engine URL.");
}
const args = process.argv.slice(2);
if (args.some((arg) => arg !== "--release")) throw new Error("Supported option: --release");
const cli = resolve(web, "node_modules/@tauri-apps/cli/tauri.js");
const result = spawnSync(process.execPath, [cli, "build", "--no-bundle", ...(args.includes("--release") ? [] : ["--debug"])], {
  cwd: web,
  stdio: "inherit",
  env: {
    ...process.env,
    PATH: `${cargoBin}${delimiter}${process.env.PATH ?? ""}`,
    CARGO_TARGET_DIR: join(homedir(), ".cache", "orbyn-notes-native", "target"),
    VITE_ENGINE_URL: engine,
  },
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
