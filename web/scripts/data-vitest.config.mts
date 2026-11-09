import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    environment: "node",
    include: [
      "tests/data/**/*.test.ts",
      "tests/account/**/*.test.ts",
      "tests/transfer/**/*.test.ts",
    ],
  },
});
