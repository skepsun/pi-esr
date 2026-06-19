#!/usr/bin/env node
import { build } from "esbuild";
import { readFileSync, writeFileSync, mkdirSync, existsSync, cpSync } from "node:fs";
import { dirname } from "node:path";

const PKG = JSON.parse(readFileSync("package.json", "utf-8"));

// 1. Standalone library bundle (no external deps except better-sqlite3)
await build({
  entryPoints: ["src/bundle.ts"],
  bundle: true,
  platform: "node",
  target: "node18",
  format: "esm",
  outfile: "dist/bundle.js",
  external: ["better-sqlite3", "zod"],
  minify: false,
  sourcemap: false,
});

// 2. Pi extension bundle (externalizes pi-specific deps)
await build({
  entryPoints: ["extensions/index.ts"],
  bundle: true,
  platform: "node",
  target: "node18",
  format: "esm",
  outfile: "dist/pi-extension.js",
  external: [
    "better-sqlite3",
    "@modelcontextprotocol/sdk",
    "zod",
    "@earendil-works/pi-coding-agent",
    "@earendil-works/pi-ai",
    "@earendil-works/pi-tui",
    "typebox",
  ],
  minify: false,
  sourcemap: false,
});

// 3. MCP server bundle (stdlib-only external deps)
await build({
  entryPoints: ["packages/adapter-mcp/src/server.ts"],
  bundle: true,
  platform: "node",
  target: "node18",
  format: "esm",
  outfile: "dist/esr-mcp.js",
  external: ["better-sqlite3", "@modelcontextprotocol/sdk", "zod"],
  banner: { js: "// ESR MCP server — invoked via node, not bash" },
  minify: false,
  sourcemap: false,
});

// Copy skills to dist
if (!existsSync("dist/skills")) mkdirSync("dist/skills", { recursive: true });
if (existsSync("skills")) cpSync("skills", "dist/skills", { recursive: true });

// Copy esr system prompt
if (!existsSync("dist/prompts")) mkdirSync("dist/prompts", { recursive: true });
if (existsSync("prompts")) cpSync("prompts", "dist/prompts", { recursive: true });

console.error(`[pi-esr] bundle: dist/bundle.js + dist/pi-extension.js + dist/esr-mcp.js`);
