import type { KnipConfig } from "knip";

const config: KnipConfig = {
  entry: ["hey-api/**/*.ts", "themes/**/*.ts"],
  project: ["**/*.ts"],
  ignore: [],
  ignoreBinaries: [
    // biome is in root package.json
    "biome",
    // provided by root/workspace packages
    "tsc",
    "vitest",
    "tsx",
    "knip",
  ],
};

export default config;
