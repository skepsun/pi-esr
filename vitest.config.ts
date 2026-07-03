import { defineConfig } from "vitest/config";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

export default defineConfig({
  resolve: {
    alias: {
      "@pi-esr/core": "./packages/core/src",
      "@pi-esr/domain-pack-software": "./packages/domain-pack-software/src",
      "@pi-esr/domain-pack-govdoc": "./packages/domain-pack-govdoc/src",
      "@pi-esr/domain-pack-planning-review": "./packages/domain-pack-planning-review/src",
      "@pi-esr/domain-pack-agent-tool": "./packages/domain-pack-agent-tool/src",
      "@pi-esr/domain-pack-refactor": "./packages/domain-pack-refactor/src",
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
