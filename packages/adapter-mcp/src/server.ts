#!/usr/bin/env node
/**
 * pi-esr/adapter-mcp: MCP stdio server
 *
 * Register this with Claude Code:
 *   claude mcp add pi-esr -- npx @pi-esr/adapter-mcp
 *
 * Or with Cursor / any MCP-compatible client via stdio transport.
 *
 * Registers ESR tools + `esr://context` resource.
 * Uses SQLite as the runtime state source and mirrors JSON snapshots for compatibility.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";

// ── Health check mode ───────────────────────────────────

if (process.argv.includes("--check")) {
  const _require = createRequire(import.meta.url);
  const checks: Array<{ name: string; ok: boolean; detail: string }> = [];

  // Check 1: Node.js version
  const nodeVersion = process.version;
  const nodeMajor = parseInt(nodeVersion.slice(1).split(".")[0], 10);
  checks.push({ name: "Node.js", ok: nodeMajor >= 18, detail: `v${nodeVersion} (requires >=18)` });

  // Check 2: better-sqlite3
  try {
    _require.resolve("better-sqlite3");
    checks.push({ name: "better-sqlite3", ok: true, detail: "available" });
  } catch {
    checks.push({ name: "better-sqlite3", ok: false, detail: "NOT FOUND — run: npm install better-sqlite3" });
  }

  // Check 3: @modelcontextprotocol/sdk
  try {
    _require.resolve("@modelcontextprotocol/sdk/server/mcp.js");
    checks.push({ name: "@modelcontextprotocol/sdk", ok: true, detail: "available" });
  } catch {
    checks.push({ name: "@modelcontextprotocol/sdk", ok: false, detail: "NOT FOUND — MCP transport unavailable" });
  }

  // Check 4: esr-state.json
  try {
    const statePath = join(process.cwd(), process.env.ESR_STORE_PATH ?? ".pi-esr-memory", "esr-state.json");
    const fs = await import("node:fs");
    const stat = fs.statSync(statePath, { throwIfNoEntry: false });
    if (stat) {
      const content = fs.readFileSync(statePath, "utf-8");
      const parsed = JSON.parse(content);
      checks.push({ name: "esr-state.json", ok: true, detail: `${(content.length / 1024).toFixed(1)}KB, ${parsed.entities?.length ?? 0} entities` });
    } else {
      checks.push({ name: "esr-state.json", ok: true, detail: "not found (will create on first use)" });
    }
  } catch (err: any) {
    checks.push({ name: "esr-state.json", ok: false, detail: `error: ${err.message}` });
  }

  // Check 5: Tool list
  try {
    const toolsModule = await import("./tools.js");
    const toolNames = Object.keys(toolsModule.TOOLS);
    checks.push({ name: "ESR tools", ok: toolNames.length > 0, detail: `${toolNames.length} registered: ${toolNames.slice(0, 8).join(", ")}${toolNames.length > 8 ? "..." : ""}` });
  } catch (err: any) {
    checks.push({ name: "ESR tools", ok: false, detail: `import error: ${err.message}` });
  }

  // Output
  const allOk = checks.every(c => c.ok);
  for (const c of checks) {
    const icon = c.ok ? "✅" : "❌";
    console.error(`${icon} ${c.name}: ${c.detail}`);
  }
  console.error(allOk ? "\n✅ All checks passed." : "\n❌ Some checks failed.");
  process.exit(allOk ? 0 : 1);
}

// ── Normal MCP server mode ──────────────────────────────

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { MemoryStore } from "../../core/src/store.js";
import {
  createMemoryProvider,
  detectMemoryCapabilities,
  type ESRMemoryProvider,
  NullMemoryProvider,
  selectMemoryProvider,
  SqliteMemoryProvider,
} from "../../memory-bridge/src/index.js";
import {
  ESRGraph,
  SqliteESRRepository,
} from "@pi-esr/core";
import { TOOLS, init, getContextText } from "./tools";
import { load } from "./persistence";

function readRootPackageJson(): {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
} | undefined {
  try {
    const raw = readFileSync(join(process.cwd(), "package.json"), "utf-8");
    return JSON.parse(raw) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
  } catch {
    return undefined;
  }
}

// ── Bootstrap ───────────────────────────────────────────

const graph = new ESRGraph();
const memoryReport = detectMemoryCapabilities({
  cwd: process.cwd(),
  env: process.env,
  packageJson: readRootPackageJson(),
  hostHints: ["mcp"],
});
const selectedMemoryProvider = selectMemoryProvider(memoryReport);

const prior = load();
if (prior) {
  const loadResult = graph.loadFromState(prior);
  if (!loadResult.ok) console.error("[pi-esr] Failed to load prior state:", loadResult.error);
}
const repository = new SqliteESRRepository(undefined, prior ?? undefined);

let memory: ESRMemoryProvider = new NullMemoryProvider();
try {
  memory = createMemoryProvider({
    report: memoryReport,
    sqliteStore: new MemoryStore(),
  });
} catch {
  memory = createMemoryProvider({
    report: memoryReport,
    sqliteStore: null,
  });
}

init(graph, memory, repository);

// ── State change hook → auto-journal ────────────────────

graph.setStateChangeHook((entityId, oldState, newState, label) => {
  if (memory instanceof SqliteMemoryProvider) {
    const store = memory.getStore();
    const transition = `${oldState} → ${newState}`;
    store.journal(entityId, transition);
    const desc = label ? ` ${label}` : "";
    store.store(entityId, `${transition}${desc}`, {
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
      inputSchema: tool.schema as any,
    },
    async (args: any) => {
      const text = await tool.handler(args);
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

**IMPORTANT — MCP vs Pi Extension**: When running as an MCP server (Claude Code, Cursor, etc.), you MUST explicitly call ESR tools for state tracking. Unlike the Pi Agent extension, the MCP path has no automatic file-change capture, no automatic test-result evaluation, and no automatic task creation. Every entity, artifact, evaluation, and state transition requires your explicit esr_* tool call. Start every session with esr_get_context() to load current state.

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

When you promote a task to stable, you MUST execute the following closure sequence.

### For every task reaching stable:

1. **Create Artifact** — use esr_update_artifact for every file produced or modified
2. **Link produces** — esr_link_relation: task --[produces]--> artifact
3. **Record Evaluation** — esr_evaluate with objective metrics
4. **Check Closure** — use esr_get_closure_status before promoting to stable
5. **Store Memory (optional)** — if a memory provider is available, use esr_mem_store summarizing what was done, why, and any caveats
6. **Group under Concept** — if multiple tasks belong to a larger initiative, create a Concept and link each task via part_of

### For every group of related tasks:

7. **Create Actor** — who executed these tasks
8. **Link evaluates** — Actor --[evaluates]--> each task with confidence and metrics
9. **Apply Constraint** — esr_apply_constraint for quality gates

### Verification checklist:
- Task entity exists with state=stable
- At least one artifact linked via produces
- Evaluation recorded with concrete metrics
- \`esr_get_closure_status\` reports ready_for_stable=true before promotion
- Memory observation stored summarizing the work when memory is available
- If part of a group: Concept + Actor + part_of relations present

## Usage

At the start of each task, create entities for the key components (modules, tasks, artifacts).
Link them with appropriate relations.
Update state as you make progress.
Use evaluations and scores for decisions and recommendations.
Start by calling esr_get_context to load the current state. Pass since_revision=N on subsequent calls to skip unchanged state.`;

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
console.error(`[pi-esr-mcp] Started with ${toolCount} tools${memory instanceof SqliteMemoryProvider ? " + memory" : ""}`);
console.error(`[pi-esr-mcp] Snapshot: ${prior ? "loaded" : "fresh"}`);
console.error(
  `[pi-esr-mcp] Memory capability: status=${memoryReport.status} confidence=${memoryReport.confidence.toFixed(2)} kinds=${memoryReport.kinds.join(",") || "none"} provider=${selectedMemoryProvider}`,
);

// ── Helpers ─────────────────────────────────────────────

function toolNameToDescription(name: string): string {
  const descriptions: Record<string, string> = {
    esr_create_entity: "Create entity (Actor/Artifact/Task/Concept/Constraint). Load state first via esr_get_context.",
    esr_update_state: "Update entity state, confidence 0-1, or metrics.",
    esr_link_relation: "Create typed relation between entities.",
    esr_evaluate: "Record evaluation with confidence 0-1 and numeric metrics.",
    esr_score: "Attach numeric score to entity.",
    esr_promote_task: "Advance Task: draft→active→stable. See closure protocol.",
    esr_update_artifact: "Create/update artifact with versioned sections.",
    esr_apply_constraint: "Apply quality gate constraint to entity.",
    esr_get_context: "Query ESR graph state. Call first. Pass since_revision=N to skip unchanged.",
    esr_get_closure_status: "Inspect whether a task has enough evidence to be promoted to stable.",
    esr_remove_entity: "Remove entity, cascade-delete relations.",
    esr_remove_relation: "Remove typed relation between entities.",
    esr_mem_store: "Store observation anchored to entity.",
    esr_mem_recall: "Recall memories by entity or text search.",
    esr_mem_timeline: "Chronological timeline for entity.",
    esr_mem_journal: "View/record state transition journal.",
    esr_complete_task: "Complete a task: record artifacts + evaluation → promote to stable.",
    esr_stack_status: "Unified health: pi-esr + pi-loom + context-mode layer status.",
  };
  return descriptions[name] ?? name;
}
