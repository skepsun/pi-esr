import { loadExternalPacks } from "./loader.js";
import type { PackLoadResult } from "./loader.js";
import { ESRDomainPackRegistry } from "./registry.js";

/**
 * Create an empty registry. All packs (including the three classic ones:
 * software, govdoc, planning-review) are loaded externally from
 * ESR_PACKS_PATH or ~/.pi-esr/packs/ via createRegistry().
 */
export function createBuiltinPackRegistry(): ESRDomainPackRegistry {
  return new ESRDomainPackRegistry();
}

/**
 * Load all packs from external directories. This is the primary entry point.
 * The classic packs (software, govdoc, planning-review) ship as physical
 * files in ~/.pi-esr/packs/ and are loaded alongside user packs.
 */
export async function createRegistry(): Promise<{
  registry: ESRDomainPackRegistry;
  external: PackLoadResult;
}> {
  const registry = createBuiltinPackRegistry();
  const external = await loadExternalPacks(registry);
  return { registry, external };
}
