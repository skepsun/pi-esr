/**
 * pi-esr/adapter-mcp: File-based persistence
 *
 * Reads/writes ESR state to .pi-esr-memory/esr-state.json.
 * On load, walks up directory tree to find existing state files,
 * so it works even when the MCP server's cwd differs from the project root.
 * Override with ESR_SNAPSHOT_PATH env var.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname, resolve, parse } from "node:path";
import type { ESRPersistedState } from "@pi-esr/core";

const SNAPSHOT_PATH =
  process.env.ESR_SNAPSHOT_PATH ?? join(process.cwd(), ".pi-esr-memory", "esr-state.json");

export function persist(state: ESRPersistedState): void {
  // Write to the existing file location if found, otherwise to default path
  const existing = findStateFile();
  const targetPath = existing ?? join(process.cwd(), ".pi-esr-memory", "esr-state.json");
  mkdirSync(dirname(targetPath), { recursive: true });
  writeFileSync(targetPath, JSON.stringify(state, null, 2), "utf-8");
}

function isValidState(data: unknown): data is ESRPersistedState {
  if (!data || typeof data !== "object") return false;
  const d = data as Record<string, unknown>;
  return (
    typeof d.version === "number" &&
    Array.isArray(d.entities) &&
    Array.isArray(d.relations) &&
    Array.isArray(d.artifacts) &&
    (d.memory_refs === undefined || Array.isArray(d.memory_refs))
  );
}

function tryLoadPath(path: string): ESRPersistedState | null {
  if (!existsSync(path)) return null;
  try {
    const data = JSON.parse(readFileSync(path, "utf-8"));
    return isValidState(data) ? data : null;
  } catch {
    return null;
  }
}

function findStateFile(): string | null {
  // 1. ESR_SNAPSHOT_PATH env var
  if (process.env.ESR_SNAPSHOT_PATH && existsSync(process.env.ESR_SNAPSHOT_PATH)) {
    return process.env.ESR_SNAPSHOT_PATH;
  }

  // 2. Walk up from cwd to find .pi-esr-memory/esr-state.json or .esr-snapshot.json
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

  // 3. Fall back to cwd (file won't exist, but persist will create it)
  return SNAPSHOT_PATH;
}

export function load(): ESRPersistedState | null {
  const filePath = findStateFile();
  if (!filePath) return null;
  return tryLoadPath(filePath);
}
