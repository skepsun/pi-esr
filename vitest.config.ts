import { defineConfig } from "vitest/config";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

export default defineConfig({
  resolve: {
    alias: {
      "@pi-esr/core": "./packages/core/src",
    },
  },
  test: {
    include: [
      "tests/**/*.test.ts",
      "packages/core/tests/**/*.test.ts",
      "packages/adapter-mcp/tests/**/*.test.ts",
    ],
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.claude/**",
    ],
    env: {
      PI_ESR_MEMORY_DIR: mkdtempSync(join(tmpdir(), "pi-esr-")),
    },
  },
});
