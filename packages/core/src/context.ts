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
 */
export function buildESRContext(graph: ESRGraph): string {
  const lines: string[] = ["[ESR_CONTEXT]", ""];
  const sortedEntities = sortEntities(graph.getAllEntities());
  const sortedRelations = sortRelations(graph.getAllRelations());
  const sortedArtifacts = sortArtifacts(graph.getAllArtifacts());

  lines.push("ENTITIES:");
  if (sortedEntities.length === 0) {
    lines.push("  (none)");
  } else {
    for (const e of sortedEntities) {
      const label = e.label ? ` "${e.label}"` : "";
      const metrics = Object.keys(e.metrics).length ? ` metrics=${JSON.stringify(e.metrics)}` : "";
      lines.push(`  ${e.entity_id} [${e.role}] state=${e.state} confidence=${e.confidence.toFixed(2)}${label}${metrics}`);
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

  const tasks = sortedEntities.filter(e => e.role === "Task");
  lines.push("TASKS:");
  if (tasks.length === 0) {
    lines.push("  (none)");
  } else {
    for (const t of tasks) {
      lines.push(`  ${t.entity_id} state=${t.state} confidence=${t.confidence.toFixed(2)}${t.label ? ` "${t.label}"` : ""}`);
    }
  }
  lines.push("");

  const constraints = sortedEntities.filter(e => e.role === "Constraint");
  lines.push("CONSTRAINTS:");
  if (constraints.length === 0) {
    lines.push("  (none)");
  } else {
    for (const c of constraints) {
      lines.push(`  ${c.entity_id} state=${c.state}${c.label ? ` "${c.label}"` : ""}`);
    }
  }

  return lines.join("\n");
}
