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
} from "@pi-esr/core";
import { TOOLS, init, isMutation, getContextText } from "./tools";
import { load, persist } from "./persistence";

// ── Bootstrap ───────────────────────────────────────────

const graph = new ESRGraph();
const runtimeStore = new ESRRuntimeStateStore();
const toolDrivers = new ToolDriverRegistry();

const prior = load();
if (prior) graph.loadFromState(prior);

let memory: MemoryStore | null = null;
try {
  memory = new MemoryStore();
} catch {
  // better-sqlite3 not installed — memory tools report errors gracefully
}

init(graph, runtimeStore, toolDrivers, memory);

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
