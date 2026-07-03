/**
 * pi-esr/adapter-mcp: File-based persistence
 *
 * Reads/writes ESR state to .pi-esr-memory/esr-state.json.
 * On load, walks up directory tree to find existing state files,
 * so it works even when the MCP server's cwd differs from the project root.
 * Override with ESR_SNAPSHOT_PATH env var.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from "node:fs";
import { join, dirname } from "node:path";
import type { ESRPersistedState } from "@pi-esr/core";
import { defaultSnapshotPath, findSnapshotPath } from "./snapshot-path";

export type PersistResult = { ok: true } | { ok: false; error: string };

export function persist(state: ESRPersistedState): PersistResult {
  // Write to the existing file location if found, otherwise to default path
  const targetPath = findStateFile();
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

function findStateFile(): string {
  return findSnapshotPath({ includeDefault: true }) ?? defaultSnapshotPath();
}

export function load(): ESRPersistedState | null {
  const filePath = findStateFile();
  return tryLoadPath(filePath);
}

function formatError(action: string, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return `${action} failed: ${message}`;
}
