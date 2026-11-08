import init from "../generated/wasm/orbyn_wasm.js";
export * from "../generated/wasm/orbyn_wasm.js";
let ready: Promise<unknown> | undefined;
export function loadEngine(): Promise<unknown> {
  ready ??= init().catch((cause: unknown) => {
    ready = undefined;
    throw new Error(
      "engine_unavailable: The verified encryption engine could not load.",
      { cause },
    );
  });
  return ready;
}
