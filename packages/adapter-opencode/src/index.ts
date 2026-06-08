/**
 * pi-esr/adapter-opencode: OpenCode MCP config generator
 *
 * OpenCode natively supports MCP servers via its configuration.
 * This adapter generates the MCP config for the ESR MCP server.
 */
import { buildESRContext, ESRGraph, MemoryStore, buildActiveMemoryContext } from "@pi-esr/core";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname, resolve, parse } from "node:path";

export interface OpenCodeMCPConfig {
  type: "local";
  command: string[];
  env?: Record<string, string>;
  enabled?: boolean;
  timeout?: number;
}

export interface OpenCodeConfig {
  mcp?: Record<string, OpenCodeMCPConfig>;
}

/**
 * Generate the MCP server config for OpenCode.
 * The ESR MCP server is started as a subprocess via npx.
 */
export function generateMCPConfig(opts?: {
  command?: string;
  timeout?: number;
}): OpenCodeMCPConfig {
  return {
    type: "local",
    command: opts?.command
      ? opts.command.split(" ")
      : ["npx", "@pi-esr/adapter-mcp"],
    enabled: true,
    timeout: opts?.timeout ?? 5000,
  };
}

/**
 * Merge ESR MCP config into an existing OpenCode config object.
 */
export function withESR(config: OpenCodeConfig = {}, opts?: {
  command?: string;
  timeout?: number;
}): OpenCodeConfig {
  return {
    ...config,
    mcp: {
      ...config.mcp,
      "pi-esr": generateMCPConfig(opts),
    },
  };
}

// ── In-process helpers (for embedded use without MCP subprocess) ──

const DEFAULT_SNAPSHOT = () =>
  join(process.cwd(), ".pi-esr-memory", "esr-state.json");

/** Walk up from cwd to find an existing ESR state file. */
function findSnapshot(): string | null {
  if (process.env.ESR_SNAPSHOT_PATH && existsSync(process.env.ESR_SNAPSHOT_PATH)) {
    return process.env.ESR_SNAPSHOT_PATH;
  }
  let dir = resolve(process.cwd());
  const root = parse(dir).root;
  const candidates = [".pi-esr-memory/esr-state.json", ".esr-snapshot.json"];
  while (dir !== root) {
    for (const c of candidates) {
      const p = join(dir, c);
      if (existsSync(p)) return p;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

let _graph: ESRGraph | null = null;
let _memory: MemoryStore | null | undefined;

/** Get or create the singleton ESR graph, loading from snapshot. */
export function getGraph(): ESRGraph {
  if (!_graph) {
    _graph = new ESRGraph();
    const snapPath = findSnapshot() ?? DEFAULT_SNAPSHOT();
    if (existsSync(snapPath)) {
      try {
        const raw = readFileSync(snapPath, "utf-8");
        const data = JSON.parse(raw);
        if (typeof data.version === "number" && Array.isArray(data.entities)) {
          _graph.loadFromState(data);
        }
      } catch { /* fresh start */ }
    }
  }
  return _graph;
}

/** Get or create the memory store. Returns null if better-sqlite3 unavailable. */
export function getMemory(): MemoryStore | null {
  if (_memory === undefined) {
    try {
      _memory = new MemoryStore();
    } catch {
      _memory = null;
    }
  }
  return _memory;
}

/** Persist current graph state to snapshot. */
export function saveGraph(): void {
  if (_graph) {
    const targetPath = findSnapshot() ?? DEFAULT_SNAPSHOT();
    writeFileSync(targetPath, JSON.stringify(_graph.toPersistedState(), null, 2), "utf-8");
  }
}

/** Build ESR + memory context for injection into system prompts. */
export function buildContext(): string {
  const graph = getGraph();
  let text = buildESRContext(graph);
  const mem = getMemory();
  if (mem) {
    const ids = graph.getAllEntities().map(e => e.entity_id);
    const memCtx = buildActiveMemoryContext(mem, ids);
    if (memCtx && !memCtx.includes("(no memories)")) {
      text += "\n\n" + memCtx;
    }
  }
  return text;
}
