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
    env: {
      PI_ESR_MEMORY_DIR: mkdtempSync(join(tmpdir(), "pi-esr-")),
    },
  },
});
