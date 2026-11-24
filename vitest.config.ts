import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The conformance CLI gets no test runner of its own: its tests run here so
    // CI covers them, and so a change to the tool cannot be green in isolation.
    include: ["tests/**/*.test.ts", "tools/**/tests/**/*.test.ts"],
    environment: "node",
  },
});
