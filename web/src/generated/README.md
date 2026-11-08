# Generated engine artifacts

The WebAssembly JavaScript, binary and declarations in `wasm/` are unchanged generated artifacts from [orbyn-engine](https://github.com/orbyn-dev/orbyn-engine) at `f61b16de7ffa23bce98aae57a6781b6e732f925b`, obtained from the generated artifact directory of [orbyn-planner](https://github.com/orbyn-dev/orbyn-planner/tree/c2d57f8ce673f3f9fcfcfb60ce3dde9aae1d0d16/web/src/generated/wasm). The artifact source is MIT OR Apache-2.0, as distinct from the Planner application. Both engine notices are retained in `wasm/`.

`contracts/` is the engine's generated TypeScript wire bindings from the same engine revision, under the same engine licence. No Planner application code is included.

`web/engine-pin.json` records the exact source and hashes. Run `node web/scripts/verify-engine.mjs` from the repository root before builds. Changing this pin requires checking source/API compatibility and all artifact hashes together. No runtime download or alternate crypto implementation is used.

The pinned engine documents build reproduction in `crates/orbyn-wasm/README.md`: cargo build for wasm32-unknown-unknown, followed by the matching wasm-bindgen CLI. This change consumes the verified generated package without installing a Rust toolchain.
