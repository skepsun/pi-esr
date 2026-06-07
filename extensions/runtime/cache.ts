import { createHash } from "node:crypto";
import { buildGraphFingerprint } from "../core/context";
import { ESRGraph } from "../core/graph";
import { ESRRuntimeStateStore } from "./state";
import type { ExecutionNode } from "./runtime-types";

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    return `{${keys.map(key => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/**
 * Build a SHA256 cache key for an execution node.
 *
 * The key is composed from:
 * - node kind and driver version
 * - stable-sorted inputs
 * - dependency outputs and states
 * - all artifact versions
 * - current graph fingerprint
 *
 * Any change in any of these dimensions produces a different key,
 * ensuring correct cache invalidation when relevant state changes.
 */
export function buildNodeCacheKey(
  node: ExecutionNode,
  graph: ESRGraph,
  store: ESRRuntimeStateStore,
): string {
  const dependencyFingerprints = node.dependencies.map(depId => {
    const dep = store.getNode(depId);
    return {
      node_id: depId,
      outputs: dep?.outputs ?? {},
      state: dep?.state ?? "missing",
    };
  });
  const artifactVersions = graph.getAllArtifacts()
    .sort((a, b) => a.id.localeCompare(b.id))
    .map(a => ({ id: a.id, version: a.version ?? 0 }));

  const payload = stableStringify({
    kind: node.kind,
    inputs: node.inputs,
    dependencyFingerprints,
    artifactVersions,
    driverVersion: node.driver_version ?? "v1",
    graphFingerprint: buildGraphFingerprint(graph),
  });

  return createHash("sha256").update(payload).digest("hex");
}

export interface RuntimeCachePersistedState {
  entries: Array<{
    key: string;
    value: Record<string, unknown>;
  }>;
}

/**
 * In-memory cache store for execution node outputs.
 * Keys are SHA256 hashes (from {@link buildNodeCacheKey}),
 * values are output Record<string, unknown>.
 * Supports persistence roundtrips via {@link toPersistedState} / {@link loadFromState}.
 */
export class InMemoryCacheStore {
  private cache = new Map<string, Record<string, unknown>>();

  /** Retrieve a cached output (defensive copy), or null. */
  get(key: string): Record<string, unknown> | null {
    const value = this.cache.get(key);
    return value ? { ...value } : null;
  }

  /** Store an output under a cache key (defensive copy). */
  set(key: string, value: Record<string, unknown>): void {
    this.cache.set(key, { ...value });
  }

  clear(): void {
    this.cache.clear();
  }

  /** Serialize for persistence. */
  toPersistedState(): RuntimeCachePersistedState {
    return {
      entries: Array.from(this.cache.entries())
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, value]) => ({ key, value: { ...value } })),
    };
  }

  /** Load state from a previously persisted snapshot. Replaces all current state. */
  loadFromState(state: RuntimeCachePersistedState): void {
    this.cache.clear();
    for (const entry of state.entries) {
      this.cache.set(entry.key, { ...entry.value });
    }
  }
}
