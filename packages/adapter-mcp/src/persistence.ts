/**
 * pi-esr/adapter-mcp: File-based persistence
 *
 * Reads/writes ESR state to .pi-esr-memory/esr-state.json.
 * On load, walks up directory tree to find existing state files,
 * so it works even when the MCP server's cwd differs from the project root.
 * Override with ESR_SNAPSHOT_PATH env var.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from "node:fs";
import { join, dirname, resolve, parse } from "node:path";
import type { ESRPersistedState } from "@pi-esr/core";

export type PersistResult = { ok: true } | { ok: false; error: string };

function defaultSnapshotPath(): string {
  return join(process.cwd(), ".pi-esr-memory", "esr-state.json");
}

export function persist(state: ESRPersistedState): PersistResult {
  // Write to the existing file location if found, otherwise to default path
  const existing = findStateFile();
  const targetPath = existing ?? defaultSnapshotPath();
  const stateDir = dirname(targetPath);

  try {
    mkdirSync(stateDir, { recursive: true });
  } catch (error) {
    return { ok: false, error: formatError("create snapshot directory", error) };
  }

  const lockPath = join(stateDir, "esr-state.json.lock");
  try {
    writeFileSync(lockPath, String(process.pid), { flag: "wx" });
  } catch (error) {
    return { ok: false, error: formatError(`acquire snapshot lock ${lockPath}`, error) };
  }

  try {
    writeFileSync(targetPath, JSON.stringify(state, null, 2), "utf-8");
    return { ok: true };
  } catch (error) {
    return { ok: false, error: formatError(`write snapshot ${targetPath}`, error) };
  } finally {
    try { unlinkSync(lockPath); } catch { /* ignore */ }
  }
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
  if (process.env.ESR_SNAPSHOT_PATH) {
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
  return defaultSnapshotPath();
}

export function load(): ESRPersistedState | null {
  const filePath = findStateFile();
  if (!filePath) return null;
  return tryLoadPath(filePath);
}

function formatError(action: string, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return `${action} failed: ${message}`;
}
