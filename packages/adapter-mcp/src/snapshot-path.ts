import { existsSync } from "node:fs";
import { dirname, join, parse, resolve } from "node:path";

const STATE_FILE_CANDIDATES = [".pi-esr-memory/esr-state.json", ".esr-snapshot.json"];

export function defaultSnapshotPath(cwd = process.cwd()): string {
  return join(cwd, ".pi-esr-memory", "esr-state.json");
}

export function findSnapshotPath(options?: {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  includeDefault?: boolean;
}): string | null {
  const cwd = options?.cwd ?? process.cwd();
  const env = options?.env ?? process.env;

  if (env.ESR_SNAPSHOT_PATH) {
    return env.ESR_SNAPSHOT_PATH;
  }

  let dir = resolve(cwd);
  const root = parse(dir).root;
  while (dir !== root) {
    for (const candidate of STATE_FILE_CANDIDATES) {
      const path = join(dir, candidate);
      if (existsSync(path)) return path;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  return options?.includeDefault ? defaultSnapshotPath(cwd) : null;
}
