import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { resolve, relative, isAbsolute } from "node:path";
export const sha256 = (bytes) =>
  createHash("sha256").update(bytes).digest("hex");
export async function readEnginePatch(root, pin) {
  if (!pin.enginePatch) return null;
  const patch = pin.enginePatch;
  if (
    typeof patch.path !== "string" ||
    !/^[a-f0-9]{64}$/.test(patch.sha256) ||
    !Array.isArray(patch.files) ||
    !patch.files.length ||
    patch.files.some((file) => typeof file !== "string")
  )
    throw new Error("Invalid engine patch manifest.");
  const path = resolve(root, patch.path),
    local = relative(root, path);
  if (local.startsWith("..") || isAbsolute(local))
    throw new Error("Engine patch must be inside the web package.");
  const bytes = await readFile(path);
  if (sha256(bytes) !== patch.sha256)
    throw new Error("Engine source patch hash mismatch.");
  return bytes;
}
export async function verifyEngineSource(source, root, pin) {
  const git = (args) => {
    const result = spawnSync("git", args, {
      cwd: source,
      maxBuffer: 16 * 1024 * 1024,
    });
    if (result.error || result.status !== 0)
      throw new Error("Cannot verify engine source checkout.");
    return result.stdout;
  };
  if (git(["rev-parse", "HEAD"]).toString().trim() !== pin.engineCommit)
    throw new Error("Engine checkout must match engine-pin.json.");
  // Ignore no source files: untracked inputs could influence a build even when the tracked diff matches.
  if (git(["ls-files", "--others", "--exclude-standard"]).length)
    throw new Error(
      "Engine source has untracked inputs. Use a clean isolated checkout.",
    );
  const diff = git([
    "-c",
    "core.autocrlf=false",
    "diff",
    "--binary",
    "--no-ext-diff",
    "--no-textconv",
    "HEAD",
    "--",
  ]);
  const patch = await readEnginePatch(root, pin);
  if (patch ? !diff.equals(patch) : diff.length !== 0)
    throw new Error(
      "Engine source changes must exactly match the reviewed patch.",
    );
  if (patch) {
    const files = git(["diff", "--name-only", "-z", "HEAD", "--"])
      .toString()
      .split("\0")
      .filter(Boolean)
      .sort();
    if (
      JSON.stringify(files) !==
      JSON.stringify([...pin.enginePatch.files].sort())
    )
      throw new Error("Engine patch file allowlist mismatch.");
  }
}
