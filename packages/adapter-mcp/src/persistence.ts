/**
 * pi-esr/adapter-mcp: File-based persistence
 *
 * Reads/writes ESR state to `.esr-snapshot.json` in the working directory.
 * Override with ESR_SNAPSHOT_PATH env var.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { ESRPersistedState } from "@pi-esr/core";

const SNAPSHOT_PATH =
  process.env.ESR_SNAPSHOT_PATH ?? join(process.cwd(), ".esr-snapshot.json");

export function persist(state: ESRPersistedState): void {
  writeFileSync(SNAPSHOT_PATH, JSON.stringify(state, null, 2), "utf-8");
}

export function load(): ESRPersistedState | null {
  if (!existsSync(SNAPSHOT_PATH)) return null;
  try {
    const raw = readFileSync(SNAPSHOT_PATH, "utf-8");
    const data = JSON.parse(raw);
    if (
      typeof data.version === "number" &&
      Array.isArray(data.entities) &&
      Array.isArray(data.relations) &&
      Array.isArray(data.artifacts)
    ) {
      return data as ESRPersistedState;
    }
    return null;
  } catch {
    return null;
  }
}
