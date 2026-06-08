/**
 * pi-esr/adapter-mcp: Zod-based MCP tool definitions
 *
 * Uses Zod schemas (as required by @modelcontextprotocol/sdk v1.x)
 * instead of raw JSON Schema for type-safe tool registration.
 */

import { z } from "zod";
import {
  ESRGraph,
  ESRRuntimeStateStore,
  ToolDriverRegistry,
  MemoryStore,
  SqliteESRRepository,
  buildESRContext,
  formatObservation,
  buildJournalSummary,
  buildActiveMemoryContext,
} from "@pi-esr/core";
import type { ExecutionNode } from "@pi-esr/core";
import { persist } from "./persistence";

// ── State holders ──────────────────────────────────────

let graph: ESRGraph;
let runtimeStore: ESRRuntimeStateStore;
let toolDrivers: ToolDriverRegistry;
let memory: MemoryStore | null = null;
let repository: SqliteESRRepository;

export function init(
  g: ESRGraph,
  rs: ESRRuntimeStateStore,
  td: ToolDriverRegistry,
  mem: MemoryStore | null,
  repo: SqliteESRRepository,
): void {
  graph = g;
  runtimeStore = rs;
  toolDrivers = td;
  memory = mem;
  repository = repo;
  registerRuntimeDrivers();
}

function onMutated(): void {
  repository.syncFromGraph(graph.toPersistedState());
  persist(graph.toPersistedState());
  runtimeStore.invalidateDependentNodes("graph mutated");
}

// ── Runtime driver registration (for esr_run DAG execution) ──

function asMetricRecord(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const metrics: Record<string, number> = {};
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === "number") metrics[key] = v;
  }
  return metrics;
}

export function registerRuntimeDrivers(): void {
  toolDrivers.register("esr_create_entity", async (params) => {
    const entityId = String(params.entity_id ?? "");
    if (!entityId) return { status: "failed", error: "entity_id required" };
    const result = graph.createEntity({
      entity_id: entityId,
      role: (params.role as any) ?? "Concept",
      state: (params.state as any) ?? "draft",
      confidence: typeof params.confidence === "number" ? params.confidence : 0,
      metrics: asMetricRecord(params.metrics),
      label: typeof params.label === "string" ? params.label : undefined,
      updated_at: new Date().toISOString(),
    });
    if (!result.ok) return { status: "failed", error: result.error };
    onMutated();
    return { status: "succeeded", outputs: { entity_id: entityId } };
  });

  toolDrivers.register("esr_update_state", async (params) => {
    const entityId = String(params.entity_id ?? "");
    if (!entityId) return { status: "failed", error: "entity_id required" };
    // Use current state if not specified (allows confidence/metrics-only updates)
    const current = graph.getEntity(entityId);
    if (!current) return { status: "failed", error: `Entity not found: ${entityId}` };
    const targetState = (params.state as any) ?? current.state;
    const result = graph.updateEntityState(
      entityId,
      targetState,
      typeof params.confidence === "number" ? params.confidence : undefined,
      asMetricRecord(params.metrics),
    );
    if (!result.ok) return { status: "failed", error: result.error };
    onMutated();
    return { status: "succeeded", outputs: { entity_id: entityId } };
  });

  toolDrivers.register("esr_link_relation", async (params) => {
    const from = String(params.from ?? "");
    const to = String(params.to ?? "");
    const type = String(params.type ?? "");
    if (!from || !to || !type) return { status: "failed", error: "from, to, type required" };
    const result = graph.linkRelation(from, to, type as any);
    if (!result.ok) return { status: "failed", error: result.error };
    onMutated();
    return { status: "succeeded", outputs: { from, to, type } };
  });

  toolDrivers.register("esr_evaluate", async (params) => {
    const entityId = String(params.entity_id ?? "");
    const evaluator = String(params.evaluator ?? "");
    if (!entityId || !evaluator || typeof params.confidence !== "number") {
      return { status: "failed", error: "entity_id, evaluator, confidence required" };
    }
    const result = graph.evaluate(entityId, evaluator, params.confidence, asMetricRecord(params.metrics));
    if (!result.ok) return { status: "failed", error: result.error };
    onMutated();
    return { status: "succeeded", outputs: { entity_id: entityId, evaluator } };
  });

  toolDrivers.register("esr_score", async (params) => {
    const entityId = String(params.entity_id ?? "");
    if (!entityId || typeof params.score_value !== "number" || !params.score_type) {
      return { status: "failed", error: "entity_id, score_value, score_type required" };
    }
    const result = graph.score(entityId, params.score_value, String(params.score_type));
    if (!result.ok) return { status: "failed", error: result.error };
    onMutated();
    return { status: "succeeded", outputs: { entity_id: entityId } };
  });

  toolDrivers.register("esr_promote_task", async (params) => {
    const entityId = String(params.entity_id ?? "");
    const newState = String(params.new_state ?? "");
    if (!entityId || !newState) return { status: "failed", error: "entity_id, new_state required" };
    const result = graph.promoteTask(entityId, newState as "active" | "stable");
    if (!result.ok) return { status: "failed", error: result.error };
    onMutated();
    return { status: "succeeded", outputs: { entity_id: entityId, state: newState } };
  });

  toolDrivers.register("esr_update_artifact", async (params) => {
    const id = String(params.id ?? "");
    const type = String(params.type ?? "");
    const sections = Array.isArray(params.sections) ? params.sections : [];
    if (!id || !type) return { status: "failed", error: "id, type required" };
    const result = graph.upsertArtifact({
      id,
      type: type as any,
      version: typeof params.version === "number" ? params.version : undefined,
      sections: sections.map((s: any) => ({ name: String(s.name ?? ""), state: (s.state as any) ?? "draft" })),
    });
    if (!result.ok) return { status: "failed", error: result.error };
    onMutated();
    return { status: "succeeded", outputs: { id } };
  });

  toolDrivers.register("esr_apply_constraint", async (params) => {
    const entityId = String(params.entity_id ?? "");
    const description = String(params.constraint_description ?? "");
    if (!entityId || !description) return { status: "failed", error: "entity_id, constraint_description required" };
    const result = graph.applyConstraint(entityId, description);
    if (!result.ok) return { status: "failed", error: result.error };
    onMutated();
    return { status: "succeeded", outputs: { entity_id: entityId } };
  });

  toolDrivers.register("esr_remove_entity", async (params) => {
    const entityId = String(params.entity_id ?? "");
    if (!entityId) return { status: "failed", error: "entity_id required" };
    const result = graph.removeEntity(entityId);
    if (!result.ok) return { status: "failed", error: result.error };
    onMutated();
    return { status: "succeeded", outputs: { entity_id: entityId } };
  });

  toolDrivers.register("esr_remove_relation", async (params) => {
    const from = String(params.from ?? "");
    const to = String(params.to ?? "");
    const type = String(params.type ?? "");
    if (!from || !to || !type) return { status: "failed", error: "from, to, type required" };
    const result = graph.removeRelation(from, to, type as any);
    if (!result.ok) return { status: "failed", error: result.error };
    onMutated();
    return { status: "succeeded", outputs: { from, to, type } };
  });

  toolDrivers.register("esr_create_node", async (params) => {
    const nodeId = String(params.node_id ?? "");
    const taskEntityId = String(params.task_entity_id ?? "");
    const kind = String(params.kind ?? "");
    const inputs = params.inputs && typeof params.inputs === "object" && !Array.isArray(params.inputs)
      ? params.inputs as Record<string, unknown>
      : {};
    if (!nodeId || !taskEntityId || !kind) return { status: "failed", error: "node_id, task_entity_id, kind required" };
    runtimeStore.createNode({
      node_id: nodeId,
      task_entity_id: taskEntityId,
      kind: kind as "tool",
      state: "pending",
      inputs,
      outputs: {},
      dependencies: Array.isArray(params.dependencies) ? params.dependencies.map(String) : [],
      retry_count: 0,
      max_retries: typeof params.max_retries === "number" ? params.max_retries : 0,
      driver_version: typeof params.driver_version === "string" ? params.driver_version : "v1",
    });
    return { status: "succeeded", outputs: { node_id: nodeId } };
  });
}

// ── Zod schemas ────────────────────────────────────────

const EntityRole = z.enum(["Actor", "Artifact", "Task", "Concept", "Constraint"]);
const EntityState = z.enum(["active", "stable", "draft", "blocked", "deprecated"]);
const ArtifactType = z.enum(["document", "code", "report", "spec"]);
const SectionState = z.enum(["draft", "editing", "stable", "invalid"]);
const RelationType = z.enum([
  "depends_on", "part_of", "implements",
  "supports", "contradicts", "refines",
  "evaluates", "scores", "validates",
  "triggers", "updates", "blocks", "produces",
]);
const TaskState = z.enum(["active", "stable"]);
const JournalAction = z.enum(["view", "record"]);

// ── Tool registry ──────────────────────────────────────

export interface ToolEntry {
  schema: z.ZodObject<any>;
  handler: (args: Record<string, unknown>) => Promise<string>;
}

export const TOOLS: Record<string, ToolEntry> = {
  esr_create_entity: {
    schema: z.object({
      entity_id: z.string(),
      role: EntityRole,
      label: z.string().optional(),
      state: EntityState.optional().default("draft"),
      confidence: z.number().min(0).max(1).optional().default(0),
      metrics: z.record(z.string(), z.number()).optional(),
    }),
    handler: async (args) => {
      const r = graph.createEntity({
        entity_id: args.entity_id as string,
        role: args.role as any,
        state: args.state as any ?? "draft",
        confidence: (args.confidence as number) ?? 0,
        metrics: (args.metrics as Record<string, number>) ?? {},
        label: args.label as string | undefined,
        updated_at: new Date().toISOString(),
      });
      if (!r.ok) return `ERROR: ${r.error}`;
      onMutated();
      return `Created entity: ${args.entity_id}`;
    },
  },

  esr_update_state: {
    schema: z.object({
      entity_id: z.string(),
      state: EntityState.optional(),
      confidence: z.number().min(0).max(1).optional(),
      metrics: z.record(z.string(), z.number()).optional(),
      expected_version: z.number().int().positive().optional(),
    }),
    handler: async (args) => {
      const entityId = args.entity_id as string;
      const current = graph.getEntity(entityId);
      if (!current) return `ERROR: Entity not found: ${entityId}`;

      if (args.state === undefined && args.confidence === undefined && !args.metrics) {
        return "ERROR: At least one of state, confidence, or metrics required";
      }

      const probe = new ESRGraph();
      probe.loadFromState(graph.toPersistedState());
      const probeResult = probe.updateEntityState(
        entityId,
        ((args.state as any) ?? current.state) as never,
        args.confidence as number | undefined,
        args.metrics as Record<string, number> | undefined,
      );
      if (!probeResult.ok) return `ERROR: ${probeResult.error}`;

      const next = probe.getEntity(entityId)!;
      const result = repository.saveEntity({
        entity: {
          ...next,
          updated_at: new Date().toISOString(),
        },
        expected_version: args.expected_version as number | undefined,
        actor_id: "mcp",
      });
      if (!result.ok) {
        if (result.conflict) {
          return `ERROR: version_conflict entity=${result.conflict.entity_id} expected=${result.conflict.expected_version} current=${result.conflict.current_version}`;
        }
        return `ERROR: ${result.error}`;
      }

      graph.loadFromState(repository.loadGraph());
      onMutated();
      return `Updated: ${entityId} state=${result.value.state} confidence=${result.value.confidence.toFixed(2)} version=${result.value.version} revision=${result.revision}`;
    },
  },

  esr_link_relation: {
    schema: z.object({
      from: z.string(),
      to: z.string(),
      type: RelationType,
    }),
    handler: async (args) => {
      const r = graph.linkRelation(args.from as string, args.to as string, args.type as any);
      if (!r.ok) return `ERROR: ${r.error}`;
      onMutated();
      return `Linked: ${args.from} --[${args.type}]--> ${args.to}`;
    },
  },

  esr_evaluate: {
    schema: z.object({
      entity_id: z.string(),
      evaluator: z.string(),
      confidence: z.number().min(0).max(1),
      metrics: z.record(z.string(), z.number()).optional(),
    }),
    handler: async (args) => {
      const r = graph.evaluate(
        args.entity_id as string, args.evaluator as string,
        args.confidence as number, (args.metrics as Record<string, number>) ?? {},
      );
      if (!r.ok) return `ERROR: ${r.error}`;
      onMutated();
      return `Evaluated: ${args.entity_id} by ${args.evaluator} confidence=${(args.confidence as number).toFixed(2)}`;
    },
  },

  esr_score: {
    schema: z.object({
      entity_id: z.string(),
      score_value: z.number(),
      score_type: z.string(),
    }),
    handler: async (args) => {
      const r = graph.score(args.entity_id as string, args.score_value as number, args.score_type as string);
      if (!r.ok) return `ERROR: ${r.error}`;
      onMutated();
      return `Scored: ${args.entity_id} ${args.score_type}=${args.score_value}`;
    },
  },

  esr_promote_task: {
    schema: z.object({
      entity_id: z.string(),
      new_state: TaskState,
    }),
    handler: async (args) => {
      const r = graph.promoteTask(args.entity_id as string, args.new_state as "active" | "stable");
      if (!r.ok) return `ERROR: ${r.error}`;
      onMutated();
      return `Promoted task: ${args.entity_id} -> ${args.new_state}`;
    },
  },

  esr_update_artifact: {
    schema: z.object({
      id: z.string(),
      type: ArtifactType,
      version: z.number().optional(),
      sections: z.array(z.object({
        name: z.string(),
        state: SectionState,
      })),
    }),
    handler: async (args) => {
      const sections = (args.sections as Array<{ name: string; state: string }>) ?? [];
      const r = graph.upsertArtifact({
        id: args.id as string,
        type: args.type as any,
        version: args.version as number | undefined,
        sections: sections.map(s => ({ name: s.name, state: s.state as any })),
      });
      if (!r.ok) return `ERROR: ${r.error}`;
      onMutated();
      return `Updated artifact: ${args.id} [${args.type}]`;
    },
  },

  esr_apply_constraint: {
    schema: z.object({
      entity_id: z.string(),
      constraint_description: z.string(),
    }),
    handler: async (args) => {
      const r = graph.applyConstraint(args.entity_id as string, args.constraint_description as string);
      if (!r.ok) return `ERROR: ${r.error}`;
      onMutated();
      return `Applied constraint to ${args.entity_id}: ${args.constraint_description}`;
    },
  },

  esr_get_context: {
    schema: z.object({
      since_revision: z.number().int().positive().optional(),
    }),
    handler: async (args) => {
      const sinceRevision = typeof args.since_revision === "number" ? args.since_revision : undefined;
      return buildESRContext(graph, { sinceRevision });
    },
  },

  esr_remove_entity: {
    schema: z.object({ entity_id: z.string() }),
    handler: async (args) => {
      const r = graph.removeEntity(args.entity_id as string);
      if (!r.ok) return `ERROR: ${r.error}`;
      onMutated();
      return `Removed entity: ${args.entity_id} (relations cascade-deleted)`;
    },
  },

  esr_remove_relation: {
    schema: z.object({
      from: z.string(),
      to: z.string(),
      type: RelationType,
    }),
    handler: async (args) => {
      const r = graph.removeRelation(args.from as string, args.to as string, args.type as any);
      if (!r.ok) return `ERROR: ${r.error}`;
      onMutated();
      return `Removed relation: ${args.from} --[${args.type}]--> ${args.to}`;
    },
  },

  esr_create_node: {
    schema: z.object({
      node_id: z.string(),
      task_entity_id: z.string(),
      kind: z.enum(["tool"]),
      inputs: z.record(z.string(), z.unknown()),
      dependencies: z.array(z.string()).optional().default([]),
      max_retries: z.number().optional().default(0),
      driver_version: z.string().optional().default("v1"),
    }),
    handler: async (args) => {
      const node: Omit<ExecutionNode, "updated_at"> = {
        node_id: args.node_id as string,
        task_entity_id: args.task_entity_id as string,
        kind: args.kind as "tool",
        state: "pending",
        inputs: args.inputs as Record<string, unknown>,
        outputs: {},
        dependencies: (args.dependencies as string[]) ?? [],
        retry_count: 0,
        max_retries: (args.max_retries as number) ?? 0,
        driver_version: (args.driver_version as string) ?? "v1",
      };
      runtimeStore.createNode(node);
      return `Created runtime node: ${args.node_id} kind=${args.kind}`;
    },
  },

  esr_run: {
    schema: z.object({ max_steps: z.number().optional().default(100) }),
    handler: async (args) => {
      const maxSteps = (args.max_steps as number) ?? 100;
      const results: string[] = [];
      for (let i = 0; i < maxSteps; i++) {
        const { computeRunnableNodes } = await import("@pi-esr/core");
        const plan = computeRunnableNodes(runtimeStore);
        for (const blocked of plan.blocked) {
          if (blocked.state !== "blocked") {
            runtimeStore.setNodeState(blocked.node_id, "blocked", { last_error: "Blocked by failed dependency" });
          }
        }
        if (plan.ready.length === 0) break;
        const next = plan.ready[0];
        runtimeStore.setNodeState(next.node_id, "running");
        const result = await toolDrivers.run(
          next.inputs.toolName as string,
          next.inputs.params as Record<string, unknown>,
          { graph, store: runtimeStore },
        );
        if (result.status === "succeeded") {
          runtimeStore.setNodeState(next.node_id, "succeeded", { outputs: result.outputs ?? {} });
          results.push(`✓ ${next.node_id}`);
        } else {
          runtimeStore.setNodeState(next.node_id, "failed", { last_error: result.error });
          results.push(`✗ ${next.node_id}: ${result.error}`);
          break;
        }
      }
      return results.length > 0 ? results.join("\n") : "Runtime: no ready nodes (idle)";
    },
  },

  esr_mem_store: {
    schema: z.object({
      entity_id: z.string(),
      content: z.string(),
      tags: z.array(z.string()).optional(),
    }),
    handler: async (args) => {
      if (!memory) return "ERROR: Memory layer not available (better-sqlite3 required)";
      const tags = (args.tags as string[]) ?? [];
      const id = memory.store(args.entity_id as string, args.content as string, { tags });
      return `Stored memory #${id} anchored to ${args.entity_id}`;
    },
  },

  esr_mem_recall: {
    schema: z.object({
      entity_id: z.string().optional(),
      query: z.string().optional(),
      limit: z.number().optional().default(20),
    }),
    handler: async (args) => {
      if (!memory) return "ERROR: Memory layer not available";
      const limit = (args.limit as number) ?? 20;
      let results;
      if (args.entity_id && args.query) {
        const searched = memory.search(args.query as string, limit * 2);
        results = searched.filter(o => o.entity_id === args.entity_id).slice(0, limit);
      } else if (args.entity_id) {
        results = memory.recall(args.entity_id as string, limit);
      } else if (args.query) {
        results = memory.search(args.query as string, limit);
      } else {
        return "Provide entity_id, query, or both";
      }
      if (results.length === 0) return "No memories found.";
      return results.map(o => formatObservation(o)).join("\n");
    },
  },

  esr_mem_timeline: {
    schema: z.object({
      entity_id: z.string(),
      limit: z.number().optional().default(50),
    }),
    handler: async (args) => {
      if (!memory) return "ERROR: Memory layer not available";
      const limit = (args.limit as number) ?? 50;
      const entries = memory.timeline(args.entity_id as string, limit);
      if (entries.length === 0) return `No memories for ${args.entity_id}`;
      return [
        `Timeline for ${args.entity_id} (${memory.countFor(args.entity_id as string)} total, showing ${entries.length}):`,
        ...entries.map(o => formatObservation(o)),
      ].join("\n");
    },
  },

  esr_mem_journal: {
    schema: z.object({
      action: JournalAction,
      entity_id: z.string().optional(),
      transition: z.string().optional(),
    }),
    handler: async (args) => {
      if (!memory) return "ERROR: Memory layer not available";
      if (args.action === "record") {
        memory.journal(args.entity_id as string, args.transition as string);
        return `Recorded journal entry: ${args.entity_id} ${args.transition}`;
      }
      if (args.entity_id) {
        return buildJournalSummary(memory, [args.entity_id as string]);
      }
      const entries = memory.getAllJournal(30);
      if (entries.length === 0) return "(no journal entries)";
      return entries.map(e => `[${e.entity_id}] ${e.created_at.slice(0, 16)}: ${e.transition}`).join("\n");
    },
  },
};

// ── Helpers ─────────────────────────────────────────────

export function isMutation(name: string): boolean {
  return !["esr_get_context", "esr_mem_recall", "esr_mem_timeline", "esr_mem_journal"].includes(name);
}

export function getContextText(): string {
  let text = buildESRContext(graph);
  if (memory) {
    const entityIds = graph.getAllEntities().map(e => e.entity_id);
    const memCtx = buildActiveMemoryContext(memory, entityIds);
    if (memCtx && !memCtx.includes("(no memories)")) {
      text += "\n\n" + memCtx;
    }
  }
  return text;
}
