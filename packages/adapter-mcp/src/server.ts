#!/usr/bin/env node
/**
 * pi-esr/adapter-mcp: MCP stdio server
 *
 * Register this with Claude Code:
 *   claude mcp add pi-esr -- npx @pi-esr/adapter-mcp
 *
 * Or with Cursor / any MCP-compatible client via stdio transport.
 *
 * Registers 17 ESR tools + `esr://context` resource.
 * Persists state to `.esr-snapshot.json` on every mutation.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ESRGraph,
  ESRRuntimeStateStore,
  ToolDriverRegistry,
  MemoryStore,
  SqliteESRRepository,
} from "@pi-esr/core";
import { TOOLS, init, isMutation, getContextText } from "./tools";
import { load, persist } from "./persistence";

// ── Bootstrap ───────────────────────────────────────────

const graph = new ESRGraph();
const runtimeStore = new ESRRuntimeStateStore();
const toolDrivers = new ToolDriverRegistry();

const prior = load();
if (prior) graph.loadFromState(prior);
const repository = new SqliteESRRepository(undefined, prior ?? undefined);

let memory: MemoryStore | null = null;
try {
  memory = new MemoryStore();
} catch {
  // better-sqlite3 not installed — memory tools report errors gracefully
}

init(graph, runtimeStore, toolDrivers, memory, repository);

// ── State change hook → auto-journal ────────────────────

graph.setStateChangeHook((entityId, oldState, newState, label) => {
  if (memory) {
    const transition = `${oldState} → ${newState}`;
    memory.journal(entityId, transition);
    const desc = label ? ` ${label}` : "";
    memory.store(entityId, `${transition}${desc}`, {
      tags: ["state-transition", `from:${oldState}`, `to:${newState}`],
    });
  }
});

// ── MCP Server ──────────────────────────────────────────

const server = new McpServer({
  name: "pi-esr",
  version: "0.3.0",
});

// Register all tools with Zod schemas
for (const [name, tool] of Object.entries(TOOLS)) {
  server.registerTool(
    name,
    {
      description: toolNameToDescription(name),
      inputSchema: tool.schema,
    },
    async (args: any) => {
      const text = await tool.handler(args);
      if (isMutation(name)) {
        persist(graph.toPersistedState());
      }
      return { content: [{ type: "text" as const, text }] };
    },
  );
}

// ESR context as a resource
server.registerResource(
  "esr-context",
  "esr://context",
  {
    title: "ESR Graph Context",
    description: "Current ESR graph state with entities, relations, artifacts, tasks, and memory",
    mimeType: "text/plain",
  },
  async () => ({
    contents: [{
      uri: "esr://context",
      mimeType: "text/plain",
      text: getContextText(),
    }],
  }),
);

// ── Start ───────────────────────────────────────────────

// ── ESR System Prompt (MCP) ──
// Embedded copy of prompts/esr.md — allows MCP clients to discover
// the ESR methodology without needing the source file on disk.
const ESR_SYSTEM_PROMPT = `You have access to ESR (Engineering State Runtime) tools. Use them to structure your work into entities, typed relations, and explicit state transitions.

## Core Ontology

### Entity Roles
Every entity MUST belong to one of: Actor, Artifact, Task, Concept, Constraint

### Relation Types (STRICT SET ONLY)

**Structural:** depends_on, part_of, implements
**Semantic:** supports, contradicts, refines
**Evaluation:** evaluates, scores, validates
**Operational:** triggers, updates, blocks, produces

### State Model
Every entity MUST have state: active | stable | draft | blocked | deprecated

### Artifact Model
Artifacts are structured objects (document, code, report, spec) with versioned sections.

## Domain Mapping Rules

### Coding
- Entity = module / class / function
- Relation = depends_on / implements

### Documents
- Entity = section / artifact / requirement
- Relation = supports / refines / contradicts

### Expert / Evaluation
- Entity = expert / evaluation / task
- Relation = evaluates / scores / validates

### Scoring System
- Evaluation entities MUST produce numeric metrics
- Scores MUST be attached to entities (not free text)

## Golden Rules

1. Everything meaningful is an Entity
2. All structure is Relation-based
3. State is the only truth
4. Actions are the only write interface
5. If it cannot be represented in ontology → DO NOT STORE
6. If it does not affect future decisions → DO NOT STORE

## Task Completion Protocol (MANDATORY)

When you promote a task to stable or complete significant work on any entity, you MUST execute the following closure sequence.

### For every task reaching stable:

1. **Create Artifact** — use esr_update_artifact for every file produced or modified
2. **Link produces** — esr_link_relation: task --[produces]--> artifact
3. **Record Evaluation** — esr_evaluate with objective metrics
4. **Store Memory** — esr_mem_store summarizing what was done, why, and any caveats
5. **Group under Concept** — if multiple tasks belong to a larger initiative, create a Concept and link each task via part_of

### For every group of related tasks:

6. **Create Actor** — who executed these tasks
7. **Link evaluates** — Actor --[evaluates]--> each task with confidence and metrics
8. **Apply Constraint** — esr_apply_constraint for quality gates

### Verification checklist:
- Task entity exists with state=stable
- At least one artifact linked via produces
- Evaluation recorded with concrete metrics
- Memory observation stored summarizing the work
- If part of a group: Concept + Actor + part_of relations present

## Usage

At the start of each task, create entities for the key components (modules, tasks, artifacts).
Link them with appropriate relations.
Update state as you make progress.
Use evaluations and scores for decisions and recommendations.
Start by calling esr_get_context to see the current state.`;

// Register MCP prompt — discoverable by Claude Code / Cursor via prompts/list
server.registerPrompt(
  "esr-system-prompt",
  {
    title: "ESR System Prompt",
    description: "Full ESR (Engineering State Runtime) methodology prompt. Load this to teach the LLM how to use ESR tools for structured task tracking, entity management, and task completion protocols.",
  },
  async () => ({
    messages: [{
      role: "user",
      content: { type: "text" as const, text: ESR_SYSTEM_PROMPT },
    }],
  }),
);

// ── Start ───────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);

const toolCount = Object.keys(TOOLS).length;
console.error(`[pi-esr-mcp] Started with ${toolCount} tools${memory ? " + memory" : ""}`);
console.error(`[pi-esr-mcp] Snapshot: ${prior ? "loaded" : "fresh"}`);

// ── Helpers ─────────────────────────────────────────────

function toolNameToDescription(name: string): string {
  const descriptions: Record<string, string> = {
    esr_create_entity: "Create a new entity. Role MUST be: Actor (agent/system), Artifact (code/doc/report/spec), Task (draft→active→stable lifecycle), Concept (grouping), or Constraint (quality gate). Start with esr_get_context, then create entities and link them via esr_link_relation.",
    esr_update_state: "Update entity state (active|stable|draft|blocked|deprecated), confidence 0-1, or metrics. When setting a Task to stable, follow closure protocol: esr_update_artifact + esr_evaluate + esr_mem_store.",
    esr_link_relation: "Create typed relation. Structural: depends_on/part_of/implements. Semantic: supports/contradicts/refines. Evaluation: evaluates/scores/validates. Operational: triggers/updates/blocks/produces. Everything meaningful is connected via relations.",
    esr_evaluate: "Record evaluation with confidence 0-1 and numeric metrics (test_count, typecheck_errors, lines_changed, etc.). Required for every Task promoted to stable. Scores are objective, not free text.",
    esr_score: "Attach numeric score to entity (quality=0.9, coverage=85). For full evaluations with confidence, use esr_evaluate instead.",
    esr_promote_task: "Advance Task: draft→active (work starts)→stable (complete). Stable REQUIRES: esr_update_artifact for produced files, esr_link_relation --[produces]-->, esr_evaluate with metrics, esr_mem_store observation. Optionally group under Concept via part_of.",
    esr_update_artifact: "Create/update artifact (document|code|report|spec) with versioned sections (draft|editing|stable|invalid). Every Task reaching stable MUST produce at least one artifact.",
    esr_apply_constraint: "Apply quality gate (e.g. 'all tests pass before stable', 'code review required'). Constraints block transitions until satisfied.",
    esr_get_context: "Query current ESR graph: entities, relations, artifacts, tasks, constraints. ALWAYS call first when starting. The ESR context is the single source of truth.",
    esr_remove_entity: "Remove entity and cascade-delete relations. Irreversible. Use when entity no longer affects future decisions.",
    esr_remove_relation: "Remove specific typed relation. Use when connection is invalid (e.g. dependency removed).",
    esr_create_node: "Create DAG runtime node linked to a Task entity. Has dependencies, tool+inputs payload. After declaring all nodes, call esr_run to execute.",
    esr_run: "Execute all pending runtime nodes in dependency order (zero-token dispatch). ALWAYS call after declaring DAG with esr_create_node. Runtime handles ordering, caching, parallel dispatch. Failure blocks dependents.",
    esr_mem_store: "Store observation anchored to ESR entity. Persists across sessions. Use after completing task work to capture what was done, why, caveats.",
    esr_mem_recall: "Recall memories by entity_id, text search, or both. Use before decisions to check entity history.",
    esr_mem_timeline: "Chronological timeline for entity. Audit state changes, evaluations, related work over time.",
    esr_mem_journal: "View/record entity state transition journal. Auto-journaled: draft→active→stable. Use view to audit, record for notes.",
  };
  return descriptions[name] ?? name;
}
