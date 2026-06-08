/**
 * pi-esr/adapter-mcp: Hook context injector
 *
 * Standalone script for Claude Code / Codex SessionStart hooks.
 * Reads ESR state from disk and outputs a JSON hook result
 * that the platform injects as MODEL_CONTEXT.
 *
 * Output format:
 *   {"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"..."}}
 *   Exit 0 on success.
 */

import { readFileSync, existsSync } from "node:fs";
import { join, dirname, resolve, parse } from "node:path";

// ── Re-implement minimal context builder (no imports from @pi-esr/core to keep bundle tiny) ──

interface MinimalEntity {
  entity_id: string;
  role: string;
  state: string;
  confidence: number;
  labels?: string[];
  metrics?: Record<string, number>;
  label?: string;
  updated_at?: string;
}

interface MinimalRelation {
  from: string;
  to: string;
  type: string;
}

interface MinimalArtifact {
  id: string;
  type: string;
  version: number;
  sections: Array<{ name: string; state: string }>;
}

interface MinimalState {
  version: number;
  entities: MinimalEntity[];
  relations: MinimalRelation[];
  artifacts: MinimalArtifact[];
}

function isValidState(data: unknown): data is MinimalState {
  if (!data || typeof data !== "object") return false;
  const d = data as Record<string, unknown>;
  return (
    typeof d.version === "number" &&
    Array.isArray(d.entities) &&
    Array.isArray(d.relations) &&
    Array.isArray(d.artifacts)
  );
}

function findStateFile(): string | null {
  if (process.env.ESR_SNAPSHOT_PATH && existsSync(process.env.ESR_SNAPSHOT_PATH)) {
    return process.env.ESR_SNAPSHOT_PATH;
  }
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
  return null;
}

function load(): MinimalState | null {
  const filePath = findStateFile();
  if (!filePath) return null;
  try {
    const data = JSON.parse(readFileSync(filePath, "utf-8"));
    return isValidState(data) ? data : null;
  } catch {
    return null;
  }
}

function sortEntities(entities: MinimalEntity[]): MinimalEntity[] {
  return [...entities].sort((a, b) => a.entity_id.localeCompare(b.entity_id));
}

function sortRelations(relations: MinimalRelation[]): MinimalRelation[] {
  return [...relations].sort((a, b) =>
    `${a.from}${a.type}${a.to}`.localeCompare(`${b.from}${b.type}${b.to}`),
  );
}

function buildMethodology(): string {
  return [
    "",
    "ESR Quick Reference",
    "──────────────────────",
    "",
    "Entity roles: Actor, Artifact, Task, Concept, Constraint",
    "State lifecycle: draft → active → stable (or blocked / deprecated)",
    "",
    "Relation types:",
    "  Structural: depends_on, part_of, implements",
    "  Semantic:   supports, contradicts, refines",
    "  Evaluation: evaluates, scores, validates",
    "  Operational: triggers, updates, blocks, produces",
    "",
    "Golden rules:",
    "  1. Everything meaningful → Entity",
    "  2. All structure → Relation",
    "  3. State is the only truth",
    "  4. If it can\'t be represented in ontology → don\'t store",
    "",
    "Closure protocol (every task reaching stable):",
    "  1. esr_update_artifact — for every file produced or modified",
    "  2. esr_link_relation task --[produces]--> artifact",
    "  3. esr_evaluate — with objective metrics",
    "  4. esr_mem_store — summary: what was done, why, caveats",
    "  5. Group under Concept + Actor --[evaluates]--> task",
    "",
    "State loading:",
    "  esr_get_context()             → full state + revision",
    "  esr_get_context(since_revision=N) → unchanged (10 tokens) or full state",
    "",
  ].join("\n");
}

function buildContext(state: MinimalState): string {
  const lines: string[] = ["[ESR_CONTEXT]", ""];
  const sortedEntities = sortEntities(state.entities);
  const sortedRelations = sortRelations(state.relations);
  const sortedArtifacts = [...state.artifacts].sort((a, b) => a.id.localeCompare(b.id));

  lines.push("ENTITIES:");
  if (sortedEntities.length === 0) {
    lines.push("  (none)");
  } else {
    for (const e of sortedEntities) {
      const label = e.label ? ` "${e.label}"` : "";
      const metrics = e.metrics && Object.keys(e.metrics).length ? ` metrics=${JSON.stringify(e.metrics)}` : "";
      lines.push(`  ${e.entity_id} [${e.role}] state=${e.state} confidence=${(e.confidence ?? 0).toFixed(2)}${label}${metrics}`);
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
      lines.push(`  ${t.entity_id} state=${t.state} confidence=${(t.confidence ?? 0).toFixed(2)}${t.label ? ` "${t.label}"` : ""}`);
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

  lines.push("");
  lines.push(`ESR revision: ${state.version}`);
  lines.push("");
  lines.push("---");
  lines.push("This snapshot is from session start and WILL NOT auto-refresh.");
  lines.push("Call esr_get_context to get the latest state mid-session.");
  lines.push("Pass since_revision=N for incremental updates (10 tokens if unchanged).");

  return lines.join("\n");
}

// ── Main ─────────────────────────────────────────────────

const state = load();

if (!state) {
  console.log(JSON.stringify({
    continue: true,
    suppressOutput: true,
  }));
  process.exit(0);
}

const contextText = buildMethodology() + "\n" + buildContext(state);

console.log(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: "SessionStart",
    additionalContext: contextText,
  },
}));

process.exit(0);
