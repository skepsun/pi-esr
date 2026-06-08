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
    esr_create_entity: "Create a new entity in the ESR state graph",
    esr_update_state: "Update entity state, confidence, or metrics in the ESR graph",
    esr_link_relation: "Create a typed relation between two entities in the ESR graph",
    esr_evaluate: "Record an evaluation against an entity with confidence and metrics",
    esr_score: "Attach a numeric score to an entity",
    esr_promote_task: "Promote a Task entity to active or stable state",
    esr_update_artifact: "Create or update a structured artifact with versioned sections",
    esr_apply_constraint: "Apply a constraint to an entity",
    esr_get_context: "Query the current ESR graph state",
    esr_remove_entity: "Remove an entity and all its relations from the ESR graph",
    esr_remove_relation: "Remove a specific relation between two entities",
    esr_create_node: "Create a runtime execution node",
    esr_run: "Execute pending runtime nodes until idle (zero-token DAG dispatch)",
    esr_mem_store: "Store an observation anchored to an ESR entity",
    esr_mem_recall: "Recall memories by entity_id, text search, or both",
    esr_mem_timeline: "Chronological timeline of all observations about an entity",
    esr_mem_journal: "View state transition journal for entities, or record a manual journal entry",
  };
  return descriptions[name] ?? name;
}
