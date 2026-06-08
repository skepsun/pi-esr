import { defineWorkspace } from "vitest/config";

export default defineWorkspace([
  {
    test: {
      name: "core",
      root: "./packages/core",
      include: ["tests/**/*.test.ts"],
    },
    resolve: {
      alias: {
        "@pi-esr/core": "./packages/core/src",
      },
    },
  },
  {
    test: {
      name: "pi-adapter",
      include: ["tests/**/*.test.ts"],
    },
    resolve: {
      alias: {
        "@pi-esr/core": "./packages/core/src",
      },
    },
  },
  {
    test: {
      name: "mcp-adapter",
      root: "./packages/adapter-mcp",
      include: ["tests/**/*.test.ts"],
    },
    resolve: {
      alias: {
        "@pi-esr/core": "./packages/core/src",
      },
    },
  },
]);
