import { defineConfig } from "vitest/config";

const isCI = process.env.CI === "true";

export default defineConfig({
  test: {
    globals: true,
    include: ["./**/*.test.ts"],
    environment: "node",
    maxConcurrency: isCI ? 10 : 5,
  },
});
