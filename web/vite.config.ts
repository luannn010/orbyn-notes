import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { createHash } from "node:crypto";
import type { Plugin } from "vite";
import { serviceWorkerSource } from "./src/ui/offline.ts";
function offlineShell(): Plugin {
  let base = "/";
  return {
    name: "notes-offline-shell",
    enforce: "post",
    configResolved(config) {
      base = config.base;
    },
    generateBundle(_options, bundle) {
      if (!base.startsWith("/") || !base.endsWith("/"))
        throw new Error(
          "Offline shell requires an absolute path base ending in /.",
        );
      const names = Object.keys(bundle)
        .filter((name) => !name.endsWith(".map"))
        .sort();
      if (!names.includes("index.html"))
        throw new Error("Offline shell requires the built index.html.");
      const hash = createHash("sha256");
      for (const name of names) {
        const file = bundle[name]!;
        hash.update(name);
        hash.update(file.type === "chunk" ? file.code : file.source);
      }
      const scope = createHash("sha256").update(base).digest("hex").slice(0, 8);
      const version = hash.digest("hex").slice(0, 16);
      this.emitFile({
        type: "asset",
        fileName: "sw.js",
        source: serviceWorkerSource(
          `orbyn-notes-shell-${scope}-${version}`,
          names.map((name) => base + name),
          base,
        ),
      });
    },
  };
}
export default defineConfig({
  plugins: [react(), offlineShell()],
  test: {
    include: ["tests/**/*.test.{ts,tsx}"],
    environment: "jsdom",
    setupFiles: ["./tests/ui/setup.ts"],
  },
});
