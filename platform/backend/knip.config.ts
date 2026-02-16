import type { KnipConfig } from "knip";

const config: KnipConfig = {
  entry: ["src/**/*.test.ts", "src/standalone-scripts/**/*.ts"],
  project: ["src/**/*.ts", "*.config.ts"],
  ignore: ["src/**/*.test.ts", "src/database/migrations/**"],
  ignoreDependencies: [
    // Workspace dependency - resolved by pnpm
    "@shared",
    // Used in logging.ts
    "pino-pretty",
    // Used by Sentry CLI for source maps
    "@sentry/cli",
    // Used as runtime for scripts
    "tsx",
  ],
  ignoreBinaries: [
    // biome is in root package.json
    "biome",
    // provided by root/workspace packages
    "tsdown",
    "vitest",
    "knip",
    "tsc",
    "drizzle-kit",
    "tsx",
    "sentry-cli",
  ],
  rules: {
    // Types/schemas are exported for API documentation and external client generation
    exports: "off",
    types: "off",
  },
};

export default config;
