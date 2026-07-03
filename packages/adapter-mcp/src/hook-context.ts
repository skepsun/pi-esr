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
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { findSnapshotPath } from "./snapshot-path";

const require = createRequire(import.meta.url);
let DatabaseModule: any = null;
try {
  DatabaseModule = require("better-sqlite3");
} catch {
  // Optional dependency unavailable — memory injection is skipped.
}

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

interface MemoryObservation {
  entity_id: string;
  content: string;
  created_at: string;
}

interface MemoryJournalEntry {
  entity_id: string;
  transition: string;
  created_at: string;
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
  return findSnapshotPath();
}

export function load(): MinimalState | null {
  const filePath = findStateFile();
  if (!filePath) return null;
  try {
    const data = JSON.parse(readFileSync(filePath, "utf-8"));
    return isValidState(data) ? data : null;
  } catch {
    return null;
  }
}

function findMemoryDbPath(): string | null {
  const memoryDir = process.env.PI_ESR_MEMORY_DIR || join(process.cwd(), ".pi-esr-memory");
  const dbPath = join(memoryDir, "memory.db");
  return existsSync(dbPath) ? dbPath : null;
}

export function buildMemoryContext(entityIds: string[]): string {
  const Database = DatabaseModule?.default ?? DatabaseModule;
  if (!Database || entityIds.length === 0) return "[ESR_MEMORY]\n\n  (no memories)\n";

  const dbPath = findMemoryDbPath();
  if (!dbPath) return "[ESR_MEMORY]\n\n  (no memories)\n";

  const db = new Database(dbPath, { readonly: true });
  try {
    const lines: string[] = ["[ESR_MEMORY]", ""];
    const sortedEntityIds = [...entityIds].sort();
    let hasContent = false;

    const obsStmt = db.prepare(
      "SELECT entity_id, content, created_at FROM observations WHERE entity_id = ? ORDER BY created_at DESC LIMIT ?",
    );
    const countStmt = db.prepare(
      "SELECT COUNT(*) as cnt FROM observations WHERE entity_id = ?",
    );
    const journalStmt = db.prepare(
      "SELECT entity_id, transition, created_at FROM journal WHERE entity_id = ? ORDER BY created_at DESC LIMIT ?",
    );

    for (const entityId of sortedEntityIds) {
      const observations = obsStmt.all(entityId, 5) as MemoryObservation[];
      const journalEntries = journalStmt.all(entityId, 3) as MemoryJournalEntry[];
      if (observations.length === 0 && journalEntries.length === 0) continue;

      const countRow = countStmt.get(entityId) as { cnt: number } | undefined;
      const obsCount = countRow?.cnt ?? observations.length;
      const suffix = obsCount > observations.length ? ` (+${obsCount - observations.length} more)` : "";

      lines.push(`${entityId} (${obsCount} obs${suffix}):`);

      for (const entry of journalEntries) {
        lines.push(`  [${entry.created_at.slice(0, 16)}] ${entry.transition}`);
      }

      for (const observation of observations) {
        const content = observation.content.length > 200
          ? observation.content.slice(0, 197) + "..."
          : observation.content;
        lines.push(`  ${observation.created_at.slice(0, 16)}: ${content}`);
      }

      lines.push("");
      hasContent = true;
    }

    if (!hasContent) {
      lines.push("  (no memories)");
      lines.push("");
    }

    return lines.join("\n");
  } catch {
    return "[ESR_MEMORY]\n\n  (no memories)\n";
  } finally {
    db.close();
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

export function buildMethodology(): string {
  return [
    "",
    "ESR Operating Protocol for Codex",
    "────────────────────────────────",
    "",
    "Use ESR for every non-trivial coding task, refactor, bugfix, test run, file edit, or architecture decision.",
    "Tool names may appear as either esr_* or mcp__pi-esr__esr_* in Codex. Use the available pi-esr MCP tools.",
    "",
    "When to call ESR:",
    "  - Session start or before planning: esr_get_context",
    "  - Starting real work: esr_create_entity, then esr_update_state to active",
    "  - Creating dependencies: esr_link_relation",
    "  - Producing or modifying files: esr_update_artifact and task --[produces]--> artifact",
    "  - Running checks or making judgments: esr_evaluate",
    "  - Finishing work: esr_complete_task preferred, or verify closure before stable",
    "  - Need previous decisions: esr_mem_recall, then esr_mem_store for new conclusions",
    "",
    "Minimum workflow:",
    "  1. Call esr_get_context before substantial work.",
    "  2. If no suitable active task exists, create a Task entity in draft.",
    "  3. Promote the task to active when implementation begins.",
    "  4. Track produced artifacts and evaluations before marking stable.",
    "  5. Complete with esr_complete_task whenever possible.",
    "",
    "Entity roles: Actor, Artifact, Task, Concept, Constraint",
    "State lifecycle: draft -> active -> stable (or blocked / deprecated)",
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
    "  5. esr_complete_task — preferred one-call closure when available",
    "",
    "State loading:",
    "  esr_get_context()             → full state + revision",
    "  esr_get_context(since_revision=N) → unchanged (10 tokens) or full state",
    "",
  ].join("\n");
}

export function buildContext(state: MinimalState): string {
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

export function buildEmptyContext(): string {
  return [
    "[ESR_CONTEXT]",
    "",
    "No persisted ESR state was found for this workspace yet.",
    "This is not a reason to skip ESR.",
    "",
    "Start protocol:",
    "  1. Call esr_get_context to confirm the live MCP state.",
    "  2. For non-trivial work, create a Task entity with esr_create_entity.",
    "  3. Promote it to active with esr_update_state when implementation begins.",
    "",
    "---",
    "This snapshot is from session start and WILL NOT auto-refresh.",
    "Call esr_get_context to get the latest state mid-session.",
  ].join("\n");
}

// ── Main ─────────────────────────────────────────────────

export function buildHookContext(state: MinimalState): string {
  return buildMethodology()
    + "\n"
    + buildContext(state)
    + "\n\n"
    + buildMemoryContext(sortEntities(state.entities).map(entity => entity.entity_id));
}

export function buildInitialHookContext(): string {
  return buildMethodology()
    + "\n"
    + buildEmptyContext()
    + "\n\n"
    + "[ESR_MEMORY]\n\n  (no memories)\n";
}

export function main(): void {
  const state = load();

  if (!state) {
    console.log(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext: buildInitialHookContext(),
      },
    }));
    return;
  }

  console.log(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext: buildHookContext(state),
    },
  }));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
