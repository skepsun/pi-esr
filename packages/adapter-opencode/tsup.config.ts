import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/cli.ts"],
  format: ["esm"],
  outDir: "dist",
  clean: true,
  target: "node22",
  platform: "node",
  bundle: true,
  splitting: false,
  external: ["better-sqlite3"],
});
