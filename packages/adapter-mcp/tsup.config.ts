import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/server.ts", "src/hook-context.ts"],
  format: ["esm"],
  outDir: "dist",
  clean: true,
  target: "node22",
  platform: "node",
  bundle: true,
  splitting: false,
  external: ["better-sqlite3"],
  env: {
    NODE_ENV: "production",
  },
});
