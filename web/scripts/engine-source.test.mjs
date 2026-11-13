import { test } from "node:test";
import { buildEngine } from "./build-engine.mjs";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm, mkdir, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, isAbsolute, basename } from "node:path";
import { spawnSync } from "node:child_process";
import {
  verifyEngineSource,
  readEnginePatch,
  sha256,
} from "./engine-source.mjs";
test("engine reproduction admits only exact reviewed source and complete patch provenance", async () => {
  const root = await mkdtemp(join(tmpdir(), "notes-engine-source-")),
    source = join(root, "engine");
  await mkdir(source);
  const git = (args) => {
    const r = spawnSync("git", args, { cwd: source });
    assert.equal(r.status, 0);
    return r.stdout;
  };
  try {
    git(["init", "--quiet"]);
    git(["config", "core.autocrlf", "false"]);
    await writeFile(join(source, "lib.rs"), "pub fn old() {}\n");
    git(["add", "lib.rs"]);
    git([
      "-c",
      "user.name=Synthetic fixture",
      "-c",
      "user.email=synthetic@example.test",
      "commit",
      "-qm",
      "Synthetic fixture",
    ]);
    const pin = { engineCommit: git(["rev-parse", "HEAD"]).toString().trim() };
    await verifyEngineSource(source, root, pin);
    const calls = [];
    const buildPin = {
      ...pin,
      build: { rustc: "rustc synthetic-test", wasmBindgen: "0.2.130" },
    };
    const environment = {
      ORBYN_RUSTC: "checked-rustc",
      RUSTC: "unverified-rustc",
      ORBYN_CARGO: "alternate-cargo",
      ORBYN_WASM_BINDGEN: "exact-bindgen",
      PATH: process.env.PATH,
    };
    const run = (command, args, options) => {
      calls.push({ command, args, options });
      return {
        status: 0,
        stdout:
          command === "checked-rustc"
            ? "rustc synthetic-test\n"
            : "wasm-bindgen 0.2.130\n",
      };
    };
    await buildEngine({ source, root, pin: buildPin, environment, run });
    const cargo = calls.find((call) => call.command === "alternate-cargo");
    assert.equal(cargo.options.env.RUSTC, "checked-rustc");
    assert.ok(
      calls.some(
        (call) =>
          call.command === "checked-rustc" && call.args[0] === "--version",
      ),
    );
    const privateCargo = join(root, "user profile with spaces", ".cargo");
    const privateRustup = join(root, "user profile with spaces", ".rustup");
    calls.length = 0;
    await buildEngine({
      source,
      root,
      pin: buildPin,
      environment: {
        ...environment,
        CARGO_HOME: privateCargo,
        RUSTUP_HOME: privateRustup,
      },
      run,
    });
    const encoded = calls.find((call) => call.command === "alternate-cargo")
      .options.env.CARGO_ENCODED_RUSTFLAGS;
    assert.equal(
      typeof encoded,
      "string",
      "cargo must receive encoded path remapping flags",
    );
    const flags = encoded.split("\x1f");
    const remap = (path) => {
      const mappings = flags
        .filter((flag) => flag.startsWith("--remap-path-prefix="))
        .map((flag) => flag.slice("--remap-path-prefix=".length).split("="));
      const match = mappings.findLast(
        ([from]) =>
          path === from ||
          path.startsWith(`${from}/`) ||
          path.startsWith(`${from}\\`),
      );
      return match ? match[1] + path.slice(match[0].length) : path;
    };
    for (const path of [source, privateCargo, privateRustup]) {
      for (const variant of new Set([path, path.replaceAll("\\", "/")])) {
        const sample = `${variant}/nested/source.rs`;
        assert.ok(
          !remap(sample).includes(variant),
          "remapped source must hide the private prefix",
        );
      }
    }
    await assert.rejects(
      buildEngine({
        source,
        root,
        pin: buildPin,
        environment: { ...environment, RUSTFLAGS: "-C opt-level=2" },
        run,
      }),
      /flags/i,
    );
    await assert.rejects(
      buildEngine({
        source,
        root,
        pin: buildPin,
        environment: {
          ...environment,
          CARGO_ENCODED_RUSTFLAGS: "-C\x1fopt-level=2",
        },
        run,
      }),
      /flags/i,
    );
    await assert.rejects(
      buildEngine({
        source,
        root,
        pin: buildPin,
        environment: { ...environment, RUSTC_WRAPPER: "unknown-wrapper" },
        run,
      }),
      /wrappers/,
    );

    await writeFile(join(source, "lib.rs"), "pub fn new() {}\n");
    await assert.rejects(
      verifyEngineSource(source, root, pin),
      /exactly match/,
    );
    const patch = git([
      "diff",
      "--binary",
      "--no-ext-diff",
      "--no-textconv",
      "HEAD",
      "--",
    ]);
    await writeFile(join(root, "reviewed.patch"), patch);
    pin.enginePatch = {
      path: "reviewed.patch",
      sha256: sha256(patch),
      files: ["lib.rs"],
    };
    await verifyEngineSource(source, root, pin);
    await writeFile(join(source, "extra.rs"), "unreviewed input");
    await assert.rejects(verifyEngineSource(source, root, pin), /untracked/);
    await rm(join(source, "extra.rs"));
    pin.enginePatch.files = ["other.rs"];
    await assert.rejects(verifyEngineSource(source, root, pin), /allowlist/);
    pin.enginePatch.files = ["lib.rs"];
    await writeFile(join(root, "reviewed.patch"), "tampered");
    await assert.rejects(verifyEngineSource(source, root, pin), /patch hash/);
    pin.enginePatch.path = "../escape.patch";
    await assert.rejects(readEnginePatch(root, pin), /inside/);
  } finally {
    const actual = await realpath(root),
      parent = await realpath(tmpdir()),
      local = relative(parent, actual);
    assert.ok(
      !local.startsWith("..") &&
        !isAbsolute(local) &&
        basename(actual).startsWith("notes-engine-source-"),
    );
    await rm(actual, { recursive: true, force: true });
  }
});
