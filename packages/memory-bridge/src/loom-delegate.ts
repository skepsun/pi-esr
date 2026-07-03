/**
 * pi-esr/memory-bridge: LoomDelegate — Bridge ESR's HostMemoryProvider to pi-loom
 *
 * When pi-loom is installed alongside pi-esr, this module dynamically imports
 * pi-loom's LoomMemoryProvider and converts it into a HostMemoryDelegate.
 *
 * The dynamic import avoids a hard dependency: if pi-loom is not installed,
 * the import fails silently and the delegate is returned as null — callers
 * fall back to SqliteMemoryProvider.
 *
 * @module
 */

import type { HostMemoryDelegate } from "./host-provider.js";

/**
 * Try to create a HostMemoryDelegate backed by pi-loom's LoomMemoryProvider.
 * Returns null if pi-loom is not installed or cannot be initialized.
 */
export async function tryCreateLoomDelegate(cwd: string): Promise<HostMemoryDelegate | null> {
  try {
    // Dynamic import — no hard dependency on pi-loom
    const loomModule = await tryImportLoom();
    if (!loomModule) return null;

    const { LoomMemoryProvider } = loomModule;
    if (!LoomMemoryProvider) return null;

    // Open or create the loom database
    const Database = await tryImportBetterSqlite3();
    if (!Database) return null;

    const { join } = await import("node:path");
    const { existsSync, mkdirSync } = await import("node:fs");

    const loomDir = process.env.PI_LOOM_DIR
      ? join(process.env.PI_LOOM_DIR)
      : join(cwd, ".pi-loom");
    const dbPath = join(loomDir, "loom.db");

    if (!existsSync(loomDir)) {
      mkdirSync(loomDir, { recursive: true });
    }

    const db = new Database(dbPath);
    db.pragma("journal_mode = WAL");

    // Construct a minimal LoomStore — pi-loom handles the heavy lifting
    const { LoomStore } = loomModule;
    if (!LoomStore) return null;

    const store = new LoomStore(db);
    const provider = new LoomMemoryProvider(store);

    // Convert ESRMemoryProvider → HostMemoryDelegate
    const delegate: HostMemoryDelegate = {
      store: async (input) => provider.store(input),
      search: async (input) => provider.search(input),
      listByEntity: async (input) => provider.listByEntity(input),
      timeline: async (input) => provider.timeline(input),
      count: async (entityId) => provider.count(entityId),
      recordJournal: async (entityId, transition, metadata) =>
        provider.recordJournal(entityId, transition, metadata),
      getJournal: async (input) => provider.getJournal(input),
      getAllJournal: async (limit) => provider.getAllJournal(limit),
      fetch: async (refs) => provider.fetch(refs),
      render: async (refs) => provider.render(refs),
    };

    return delegate;
  } catch (err) {
    console.error("[pi-esr/loom-delegate] Failed to initialize loom bridge:", (err as Error).message);
    return null;
  }
}

async function tryImportLoom(): Promise<any | null> {
  // Try multiple import paths to find pi-loom
  const paths = [
    // Direct path (monorepo development)
    "../../pi-loom/src/index.js",
    "../../pi-loom/dist/index.js",
    // npm package path
    "pi-loom",
    "@pi/pi-loom",
  ];

  for (const p of paths) {
    try {
      if (p.startsWith(".")) {
        // Relative paths — use import() with file:// URL
        const { pathToFileURL } = await import("node:url");
        const { resolve } = await import("node:path");
        const url = pathToFileURL(resolve(import.meta.dirname ?? __dirname, p)).href;
        return await import(url);
      } else {
        return await import(p);
      }
    } catch {
      continue;
    }
  }

  return null;
}

async function tryImportBetterSqlite3(): Promise<any | null> {
  try {
    return (await import("better-sqlite3")).default;
  } catch {
    return null;
  }
}
