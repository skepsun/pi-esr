/**
 * pi-esr: Stable ESR context builders
 */

import type { ESRArtifact, ESREntity, ESRRelation } from "./types.js";
import { ESRGraph } from "./graph.js";

function sortEntities(entities: ESREntity[]): ESREntity[] {
  return [...entities].sort((a, b) => a.entity_id.localeCompare(b.entity_id));
}

function sortRelations(relations: ESRRelation[]): ESRRelation[] {
  return [...relations].sort((a, b) =>
    `${a.from}${a.type}${a.to}`.localeCompare(`${b.from}${b.type}${b.to}`),
  );
}

function sortArtifacts(artifacts: ESRArtifact[]): ESRArtifact[] {
  return [...artifacts].sort((a, b) => a.id.localeCompare(b.id));
}

/** Build a deterministic, sorted JSON snapshot of the graph state. */
export function buildStableSnapshot(graph: ESRGraph): string {
  return JSON.stringify({
    entities: sortEntities(graph.getAllEntities()).map(e => ({
      id: e.entity_id,
      role: e.role,
      state: e.state,
      confidence: e.confidence,
      metrics: e.metrics,
      label: e.label,
    })),
    relations: sortRelations(graph.getAllRelations()),
    artifacts: sortArtifacts(graph.getAllArtifacts()),
  });
}

/** DJB2 hash-based fingerprint for cache-hit diagnosis. */
export function buildGraphFingerprint(graph: ESRGraph): string {
  const snapshot = buildStableSnapshot(graph);
  let hash = 5381;
  for (let i = 0; i < snapshot.length; i++) {
    hash = ((hash << 5) + hash + snapshot.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * Build the LLM context injection block from the current graph state.
 * Output is deterministically sorted — entities by id, relations by (from, type, to),
 * artifacts by id. This guarantees prefix-cache stability for LLM providers.
 *
 * When `sinceRevision` is provided and matches the current graph version,
 * returns a minimal "no changes" message to avoid re-transmitting identical
 * state. When it does not match (or is omitted), returns the full context.
 *
 * When `entityId` + `depth` are provided, returns only the neighborhood subgraph
 * centered on that entity within `depth` hops. When omitted, returns all entities.
 */
export function buildESRContext(graph: ESRGraph, opts?: {
  sinceRevision?: number;
  entityId?: string;
  depth?: number;
}): string {
  const currentVersion = graph.getVersion();

  // Incremental: no changes
  if (opts?.sinceRevision !== undefined && opts.sinceRevision >= currentVersion) {
    return [
      "[ESR_CONTEXT]",
      "",
      `ESR state unchanged since revision ${opts.sinceRevision}.`,
      "",
      `ESR revision: ${currentVersion}`,
    ].join("\n");
  }

  const lines: string[] = ["[ESR_CONTEXT]", ""];

  // Select entities/relations: neighborhood or full graph
  let entities: ESREntity[];
  let relations: ESRRelation[];
  if (opts?.entityId && opts?.depth !== undefined) {
    const nh = graph.getNeighborhood(opts.entityId, opts.depth);
    entities = nh.entities;
    relations = nh.relations;
    lines.push(`(neighborhood: entity=${opts.entityId} depth=${opts.depth})`);
    lines.push("");
  } else {
    entities = graph.getAllEntities();
    relations = graph.getAllRelations();
  }

  const sortedEntities = sortEntities(entities);
  const sortedRelations = sortRelations(relations);

  // Artifacts remain full — small and always relevant
  const sortedArtifacts = sortArtifacts(graph.getAllArtifacts());

  lines.push("ENTITIES:");
  if (sortedEntities.length === 0) {
    lines.push("  (none)");
  } else {
    const hasMore = opts?.entityId && entities.length < graph.getAllEntities().length;
    for (const e of sortedEntities) {
      const parts: string[] = [];
      parts.push(`${e.entity_id} [${e.role}] state=${e.state}`);
      if (e.confidence !== 1.0) parts.push(`conf=${e.confidence.toFixed(2)}`);
      if (e.label) parts.push(`"${e.label}"`);
      if (Object.keys(e.metrics).length) parts.push(`metrics=${JSON.stringify(e.metrics)}`);
      lines.push(`  ${parts.join(" ")}`);
    }
    if (hasMore) {
      lines.push(`  ... (${graph.getAllEntities().length - entities.length} more entities outside neighborhood)`);
    }
  }
  lines.push("");

  lines.push("RELATIONS:");
  if (sortedRelations.length === 0) {
    lines.push("  (none)");
  } else {
    for (const r of sortedRelations) lines.push(`  ${r.from} --[${r.type}]--> ${r.to}`);
  }
  lines.push("");

  lines.push("ARTIFACTS:");
  if (sortedArtifacts.length === 0) {
    lines.push("  (none)");
  } else {
    for (const a of sortedArtifacts) {
      lines.push(`  ${a.id} [${a.type}] v${a.version}:`);
      for (const s of a.sections) lines.push(`    - ${s.name}: ${s.state}`);
    }
  }
  lines.push("");
  lines.push(`ESR revision: ${currentVersion}`);

  return lines.join("\n");
}
