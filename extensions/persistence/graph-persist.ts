/**
 * pi-esr: Unified ESR graph persistence
 *
 * Write path:
 *   1. Session branch entry (per-session audit trail)
 *   2. Project-level JSON file (.pi-esr-memory/esr-state.json) — cross-session source of truth
 *
 * Read path:
 *   1. Current session branch entries (most specific — last entry wins)
 *   2. Project-level JSON file
 *   3. Bootstrap: scan past session files (one-time migration from old sessions)
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { ESRGraph } from "@pi-esr/core";
import type { ESRPersistedState } from "@pi-esr/core";
import { writeFileSync, readFileSync, existsSync, readdirSync, statSync, createReadStream } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";

// ═══════════════════════════════════════════════════════════
// File paths
// ═══════════════════════════════════════════════════════════

function getFilePath(): string {
  return join(process.cwd(), ".pi-esr-memory", "esr-state.json");
}

function isPersistedState(data: unknown): data is ESRPersistedState {
  if (!data || typeof data !== "object") return false;
  const d = data as Record<string, unknown>;
  return (
    typeof d.version === "number" &&
    Array.isArray(d.entities) &&
    Array.isArray(d.relations) &&
    Array.isArray(d.artifacts)
  );
}

// ═══════════════════════════════════════════════════════════
// Write path
// ═══════════════════════════════════════════════════════════

export function persistGraphState(pi: ExtensionAPI, graph: ESRGraph): void {
  const state = graph.toPersistedState();
  const stateJson = JSON.stringify(state);

  // Session branch (per-session audit trail)
  try {
    pi.appendEntry("esr-state", state);
  } catch (err) {
    console.error("[pi-esr] Failed to append to session:", err);
  }

  // Project-level file (cross-session continuity)
  try {
    writeFileSync(getFilePath(), stateJson, { flag: "w" });
  } catch (err) {
    console.error("[pi-esr] Failed to write state file:", err);
  }
}

// ═══════════════════════════════════════════════════════════
// Read path
// ═══════════════════════════════════════════════════════════

export async function loadGraphState(ctx: ExtensionContext, graph: ESRGraph): Promise<void> {
  graph.clear();
  let loaded = false;

  // 1. Session branch entries (last one wins — most recent state)
  loaded = tryLoadFromSessionBranch(ctx, graph);

  // 2. Project-level file
  if (!loaded) {
    loaded = tryLoadFromFile(graph);
  }

  // 3. Bootstrap: scan past sessions (one-time migration)
  if (!loaded) {
    const sessionDir = tryGetSessionDir(ctx);
    if (sessionDir) {
      loaded = await scanSessionsForState(graph, sessionDir);
    }
  }
}

export function clearGraphState(pi: ExtensionAPI): void {
  try {
    const empty = { version: 0, entities: [], relations: [], artifacts: [] };
    pi.appendEntry("esr-state", empty);
    writeFileSync(getFilePath(), JSON.stringify(empty, null, 2), { flag: "w" });
  } catch { /* ignore */ }
}

// ═══════════════════════════════════════════════════════════
// Internal
// ═══════════════════════════════════════════════════════════

function tryLoadFromSessionBranch(ctx: ExtensionContext, graph: ESRGraph): boolean {
  // Walk all entries, load the LAST matching esr-state (most recent)
  let lastData: ESRPersistedState | null = null;
  for (const entry of ctx.sessionManager.getBranch()) {
    if (entry.type === "custom" && (entry as { customType?: string }).customType === "esr-state") {
      const data = (entry as { data?: unknown }).data;
      if (isPersistedState(data)) {
        lastData = data;
      }
    }
  }
  if (lastData) {
    graph.loadFromState(lastData);
    return true;
  }
  return false;
}

function tryLoadFromFile(graph: ESRGraph): boolean {
  try {
    const fp = getFilePath();
    if (!existsSync(fp)) return false;
    const data = JSON.parse(readFileSync(fp, "utf-8"));
    if (!isPersistedState(data)) return false;
    graph.loadFromState(data);
    return true;
  } catch (err) {
    console.error("[pi-esr] Failed to load from file:", err);
    return false;
  }
}

function tryGetSessionDir(ctx: ExtensionContext): string | null {
  try { return ctx.sessionManager.getSessionDir(); } catch { return null; }
}

async function scanSessionsForState(graph: ESRGraph, sessionDir: string): Promise<boolean> {
  try {
    if (!existsSync(sessionDir)) return false;
    const files = readdirSync(sessionDir)
      .filter(f => f.endsWith(".jsonl"))
      .map(f => ({ path: join(sessionDir, f), mtime: statSync(join(sessionDir, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, 20);

    for (const { path } of files) {
      const state = await extractStateFromSessionFile(path);
      if (state && (state.entities.length > 0 || state.relations.length > 0)) {
        graph.loadFromState(state);
        // Seed the file so bootstrap never runs again
        try { writeFileSync(getFilePath(), JSON.stringify(state, null, 2), { flag: "w" }); } catch { /* ignore */ }
        return true;
      }
    }
    return false;
  } catch (err) {
    console.error("[pi-esr] Session scan failed:", err);
    return false;
  }
}

function extractStateFromSessionFile(filePath: string): Promise<ESRPersistedState | null> {
  return new Promise((resolve) => {
    const lines: string[] = [];
    const rl = createInterface({
      input: createReadStream(filePath, { encoding: "utf-8" }),
      crlfDelay: Infinity,
    });
    rl.on("line", (line) => { lines.push(line); });
    rl.on("close", () => {
      for (let i = lines.length - 1; i >= 0; i--) {
        try {
          const entry = JSON.parse(lines[i]);
          if (entry.type === "custom" && entry.customType === "esr-state" && isPersistedState(entry.data)) {
            resolve(entry.data);
            return;
          }
        } catch { /* skip */ }
      }
      resolve(null);
    });
    rl.on("error", () => resolve(null));
  });
}
