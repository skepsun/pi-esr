/**
 * pi-esr/adapter-mcp: Zod-based MCP tool definitions
 *
 * Uses Zod schemas (as required by @modelcontextprotocol/sdk v1.x)
 * instead of raw JSON Schema for type-safe tool registration.
 */

import { z } from "zod";
import { buildPackApplyPlan, createRegistry, detectBestPack } from "../../domain-pack/src/index.js";
import type { ESRMemoryProvider } from "../../memory-bridge/src/index.js";
import { SqliteMemoryProvider } from "../../memory-bridge/src/index.js";
import { buildJournalSummary } from "../../core/src/journal.js";
import { buildActiveMemoryContext } from "../../core/src/recall.js";
import { MemoryStore } from "../../core/src/store.js";
import {
  ESRGraph,
  SqliteESRRepository,
  buildESRContext,
  getClosureStatus,
  listClosureGaps,
  listTasks,
} from "@pi-esr/core";
import { McpStateService } from "./state-service";

// ── State holders ──────────────────────────────────────

let graph: ESRGraph;
let memory: ESRMemoryProvider = new SqliteMemoryProvider(new MemoryStore(":memory:"));
let repository: SqliteESRRepository;
let stateService: McpStateService;

export function init(
  g: ESRGraph,
  mem: ESRMemoryProvider,
  repo: SqliteESRRepository,
): void {
  graph = g;
  memory = mem;
  repository = repo;
  stateService = new McpStateService(graph, repository);
}

function finishGraphMutation(successText: string): string {
  const result = stateService.commitGraphMutation();
  return result.ok ? successText : `ERROR: ${result.error}`;
}

function finishRepositoryMutation(successText: string): string {
  const result = stateService.commitRepositoryMutation();
  return result.ok ? successText : `ERROR: ${result.error}`;
}

// ── Tool registry ──────────────────────────────────────

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
const JournalAction = z.enum(["view", "record"]);
const { registry: packRegistry } = await createRegistry();
const packs = packRegistry.list();

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
      return finishGraphMutation(`Created entity: ${args.entity_id}`);
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
      const probeLoadResult = probe.loadFromState(graph.toPersistedState());
      if (!probeLoadResult.ok) return `ERROR: internal state invalid: ${probeLoadResult.error}`;
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

      return finishRepositoryMutation(`Updated: ${entityId} state=${result.value.state} confidence=${result.value.confidence.toFixed(2)} version=${result.value.version} revision=${result.revision}`);
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
      return finishGraphMutation(`Linked: ${args.from} --[${args.type}]--> ${args.to}`);
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
      return finishGraphMutation(`Evaluated: ${args.entity_id} by ${args.evaluator} confidence=${(args.confidence as number).toFixed(2)}`);
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
      return finishGraphMutation(`Updated artifact: ${args.id} [${args.type}]`);
    },
  },

  esr_get_context: {
    schema: z.object({
      since_revision: z.number().int().positive().optional().describe("Skip unchanged state"),
      entity_id: z.string().optional().describe("Center entity for neighborhood query"),
      depth: z.number().int().min(0).max(5).optional().default(1).describe("Neighborhood depth (hops)"),
      include_memory: z.boolean().optional().default(true).describe("Append anchored memories"),
    }),
    handler: async (args) => {
      const sinceRevision = typeof args.since_revision === "number" ? args.since_revision : undefined;
      const entityId = typeof args.entity_id === "string" ? args.entity_id : undefined;
      const depth = typeof args.depth === "number" ? args.depth : undefined;
      const includeMemory = typeof args.include_memory === "boolean" ? args.include_memory : true;
      const context = buildESRContext(graph, { sinceRevision, entityId, depth });
      if (!includeMemory || context.includes("unchanged since revision")) {
        return context;
      }
      return appendMemoryContext(context);
    },
  },

  esr_detect_pack: {
    schema: z.object({
      prompt: z.string(),
    }),
    handler: async (args) => {
      const result = await detectBestPack(packs, {
        prompt: args.prompt as string,
        cwd: process.cwd(),
        host: "mcp",
      });
      if (!result.pack) {
        return "No matching domain pack found.";
      }
      return `Detected pack: ${result.pack.name} score=${result.score.toFixed(2)}`;
    },
  },

  esr_list_packs: {
    schema: z.object({
      _: z.string().optional().describe("Unused — ensures schema compatibility with Pi Agent tool normalization"),
    }),
    handler: async () => {
      const packList = packRegistry.list();
      return [
        `Available packs (${packList.length}):`,
        ...packList.map((pack) => `- ${pack.name}@${pack.version}${pack.description ? `: ${pack.description}` : ""}`),
      ].join("\n");
    },
  },

  esr_expand_with_pack: {
    schema: z.object({
      goal: z.string(),
      pack_name: z.string().optional(),
    }),
    handler: async (args) => {
      const pack = args.pack_name
        ? packs.find((item) => item.name === args.pack_name)
        : (await detectBestPack(packs, {
          prompt: args.goal as string,
          cwd: process.cwd(),
          host: "mcp",
        })).pack;
      if (!pack) {
        return `ERROR: Pack not found: ${args.pack_name ?? "(auto)"}`;
      }

      const expansion = await pack.expand({
        goal: args.goal as string,
        cwd: process.cwd(),
      });
      const validation = await pack.validate({
        context: `${args.goal as string}\n${buildESRContext(graph)}`,
        cwd: process.cwd(),
      });
      const plan = buildPackApplyPlan(expansion, validation);

      for (const entity of plan.entities) {
        const result = graph.createEntity({
          entity_id: entity.entity_id,
          role: entity.role,
          state: entity.state ?? "draft",
          confidence: entity.confidence ?? 0,
          metrics: entity.metrics ?? {},
          label: entity.label,
          updated_at: new Date().toISOString(),
        });
        if (!result.ok && !result.error.includes("already exists")) {
          return `ERROR: ${result.error}`;
        }
      }

      for (const artifact of plan.artifacts) {
        const result = graph.upsertArtifact({
          id: artifact.id,
          type: artifact.type,
          sections: artifact.sections.map((section) => ({
            name: section.name,
            state: section.state,
          })),
        });
        if (!result.ok) return `ERROR: ${result.error}`;
      }

      for (const relation of plan.relations) {
        const result = graph.linkRelation(relation.from, relation.to, relation.type);
        if (!result.ok && !result.error.includes("already exists")) {
          return `ERROR: ${result.error}`;
        }
      }

      for (const constraint of plan.constraints) {
        const result = graph.applyConstraint(constraint.entity_id, constraint.description);
        if (!result.ok) return `ERROR: ${result.error}`;
      }

      for (const evaluation of plan.evaluations) {
        const result = graph.evaluate(
          evaluation.entity_id,
          evaluation.evaluator,
          evaluation.confidence,
          evaluation.metrics ?? {},
        );
        if (!result.ok) return `ERROR: ${result.error}`;
      }

      for (const memoryRef of plan.memoryRefs) {
        const result = graph.attachMemoryRef(memoryRef.entity_id, {
          ref_id: memoryRef.ref_id,
          provider: memoryRef.provider,
          entity_id: memoryRef.entity_id,
          kind: memoryRef.kind,
          title: memoryRef.title,
          created_at: memoryRef.created_at ?? new Date().toISOString(),
        });
        if (!result.ok && !result.error.includes("already attached")) {
          return `ERROR: ${result.error}`;
        }
      }

      return finishGraphMutation(`Expanded with pack: ${pack.name} checks=${plan.checks?.length ?? 0} gaps=${plan.gaps.join(",") || "none"}`);
    },
  },

  esr_complete_task: {
    schema: z.object({
      task_id: z.string(),
      artifacts: z.array(z.object({
        id: z.string(),
        type: ArtifactType,
        sections: z.array(z.object({
          name: z.string(),
          state: z.enum(["draft", "editing", "stable", "invalid"]),
        })),
      })),
      evaluation: z.object({
        evaluator: z.string(),
        confidence: z.number().min(0).max(1),
        metrics: z.record(z.string(), z.number()).optional(),
      }),
      memory_ref: z.object({
        provider: z.string(),
        ref_id: z.string(),
        kind: z.enum(["summary", "decision", "incident", "note"]),
        title: z.string().optional(),
      }).optional(),
      constraints: z.array(z.string()).optional(),
    }),
    handler: async (args) => {
      const taskId = args.task_id as string;
      const task = graph.getEntity(taskId);
      if (!task) return `ERROR: Task not found: ${taskId}`;

      const steps: string[] = [];

      // 1. Record every artifact + produces relation
      for (const artifact of (args.artifacts as any[])) {
        const result = graph.upsertArtifact({
          id: artifact.id,
          type: artifact.type as "document" | "code" | "report" | "spec",
          sections: (artifact.sections as any[]).map((s: any) => ({ name: s.name as string, state: s.state as any })),
        });
        if (!result.ok) return `ERROR: Artifact ${artifact.id}: ${result.error}`;
        steps.push(`artifact: ${artifact.id}`);

        const linkResult = graph.linkRelation(taskId, artifact.id as string, "produces");
        if (!linkResult.ok && !linkResult.error.includes("already exists")) {
          return `ERROR: Link produces ${artifact.id}: ${linkResult.error}`;
        }
      }

      // 2. Record evaluation
      const evalArgs = args.evaluation as any;
      const evalResult = graph.evaluate(
        taskId,
        evalArgs.evaluator,
        evalArgs.confidence,
        evalArgs.metrics ?? {},
      );
      if (!evalResult.ok) return `ERROR: Evaluation: ${evalResult.error}`;
      steps.push(`evaluation: conf=${evalArgs.confidence.toFixed(2)}`);

      // 3. Optional memory ref
      if (args.memory_ref) {
        const refArgs = args.memory_ref as any;
        const refResult = graph.attachMemoryRef(taskId, {
          ref_id: refArgs.ref_id,
          provider: refArgs.provider,
          entity_id: taskId,
          kind: refArgs.kind,
          title: refArgs.title,
          created_at: new Date().toISOString(),
        });
        if (!refResult.ok && !refResult.error.includes("already attached")) {
          return `ERROR: Memory ref: ${refResult.error}`;
        }
        steps.push(`memory_ref: ${refArgs.provider}:${refArgs.ref_id}`);
      }

      // 3b. Optional constraints
      if (args.constraints) {
        for (const desc of args.constraints as string[]) {
          const cResult = graph.applyConstraint(taskId, desc);
          if (!cResult.ok) return `ERROR: Constraint "${desc}": ${cResult.error}`;
          steps.push(`constraint: ${desc}`);
        }
      }

      // 4. Validate closure
      const closureStatus = getClosureStatus(graph, taskId);
      if (!closureStatus.ready_for_stable) {
        return `Task ${taskId}: steps completed but closure not ready. Missing: ${closureStatus.missing.join(", ")}
  Steps: ${steps.join(", ")}`;
      }

      // 5. Promote to stable
      const promoteResult = graph.promoteTask(taskId, "stable");
      if (!promoteResult.ok) return `ERROR: ${promoteResult.error}`;
      steps.push("promoted to stable");

      return finishGraphMutation(`Completed task: ${taskId} → stable (${steps.join(", ")})`);
    },
  },

  esr_get_closure_status: {
    schema: z.object({
      task_id: z.string(),
      require_memory_ref_for_stable: z.boolean().optional().default(false),
    }),
    handler: async (args) => {
      const status = getClosureStatus(graph, args.task_id as string, {
        policy: {
          require_memory_ref_for_stable: (args.require_memory_ref_for_stable as boolean) ?? false,
        },
      });
      if (!status.task_exists) {
        return `ERROR: Task not found: ${args.task_id}`;
      }
      if (status.ready_for_stable) {
        return `Closure ready: ${args.task_id} can be promoted to stable`;
      }
      return `Closure blocked: ${args.task_id} missing ${status.missing.join(", ")}`;
    },
  },

  esr_attach_memory_ref: {
    schema: z.object({
      entity_id: z.string(),
      ref_id: z.string(),
      provider: z.string(),
      kind: z.enum(["summary", "decision", "incident", "note"]),
      title: z.string().optional(),
      created_at: z.string().optional(),
    }),
    handler: async (args) => {
      const result = graph.attachMemoryRef(args.entity_id as string, {
        ref_id: args.ref_id as string,
        provider: args.provider as string,
        entity_id: args.entity_id as string,
        kind: args.kind as "summary" | "decision" | "incident" | "note",
        title: args.title as string | undefined,
        created_at: (args.created_at as string | undefined) ?? new Date().toISOString(),
      });
      if (!result.ok) return `ERROR: ${result.error}`;
      return finishGraphMutation(`Attached memory ref ${args.provider}:${args.ref_id} to ${args.entity_id}`);
    },
  },

  esr_list_closure_gaps: {
    schema: z.object({
      include_ready: z.boolean().optional().default(false),
    }),
    handler: async (args) => {
      const items = listClosureGaps(graph, {
        includeReady: (args.include_ready as boolean) ?? false,
      });
      if (items.length === 0) {
        return "No closure gaps found.";
      }
      return [
        `Closure gaps (${items.length}):`,
        ...items.map((item) => {
          const suffix = item.ready_for_stable ? "ready" : `missing ${item.missing.join(", ")}`;
          return `- ${item.task_id}${item.label ? ` (${item.label})` : ""}: ${suffix}`;
        }),
      ].join("\n");
    },
  },

  esr_list_tasks: {
    schema: z.object({
      state: EntityState.optional(),
      include_ready: z.boolean().optional().default(true),
      require_memory_ref_for_stable: z.boolean().optional().default(false),
    }),
    handler: async (args) => {
      const items = listTasks(graph, {
        state: args.state as "active" | "stable" | "draft" | "blocked" | "deprecated" | undefined,
        includeReady: (args.include_ready as boolean) ?? true,
        policy: {
          require_memory_ref_for_stable: (args.require_memory_ref_for_stable as boolean) ?? false,
        },
      });
      if (items.length === 0) {
        return "No tasks found.";
      }
      return [
        `Tasks (${items.length}):`,
        ...items.map((item) => {
          const closure = item.ready_for_stable ? "ready" : `missing ${item.missing.join(", ")}`;
          return `- ${item.task_id}${item.label ? ` (${item.label})` : ""}: state=${item.task_state} confidence=${item.confidence.toFixed(2)} closure=${closure} memory_refs=${item.memory_ref_ids.length}`;
        }),
      ].join("\n");
    },
  },

  esr_remove_entity: {
    schema: z.object({ entity_id: z.string() }),
    handler: async (args) => {
      const r = graph.removeEntity(args.entity_id as string);
      if (!r.ok) return `ERROR: ${r.error}`;
      return finishGraphMutation(`Removed entity: ${args.entity_id} (relations cascade-deleted)`);
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
      return finishGraphMutation(`Removed relation: ${args.from} --[${args.type}]--> ${args.to}`);
    },
  },

  esr_mem_store: {
    schema: z.object({
      entity_id: z.string(),
      content: z.string(),
      tags: z.array(z.string()).optional(),
    }),
    handler: async (args) => {
      if (!await memory.isAvailable()) return "ERROR: Memory layer not available (better-sqlite3 required)";
      const tags = (args.tags as string[]) ?? [];
      const ref = await memory.store({
        entityId: args.entity_id as string,
        kind: "note",
        content: args.content as string,
        metadata: { tags },
      });
      return `Stored memory #${ref.ref_id} anchored to ${args.entity_id}`;
    },
  },

  esr_mem_recall: {
    schema: z.object({
      entity_id: z.string().optional(),
      query: z.string().optional(),
      limit: z.number().optional().default(20),
    }),
    handler: async (args) => {
      if (!await memory.isAvailable()) return "ERROR: Memory layer not available";
      const limit = (args.limit as number) ?? 20;
      let results;
      if (args.entity_id && args.query) {
        results = await memory.fetch(await memory.search({
          query: args.query as string,
          entityId: args.entity_id as string,
          limit,
        }));
      } else if (args.entity_id) {
        results = await memory.fetch(await memory.listByEntity({
          entityId: args.entity_id as string,
          limit,
        }));
      } else if (args.query) {
        results = await memory.fetch(await memory.search({ query: args.query as string, limit }));
      } else {
        return "Provide entity_id, query, or both";
      }
      if (results.length === 0) return "No memories found.";
      return results.map((record) => {
        if (memory instanceof SqliteMemoryProvider) {
          return memory.formatRecord(record);
        }
        return `[${record.ref.entity_id}] ${record.ref.created_at.slice(0, 16)}: ${record.content}`;
      }).join("\n");
    },
  },

  esr_mem_timeline: {
    schema: z.object({
      entity_id: z.string(),
      limit: z.number().optional().default(50),
    }),
    handler: async (args) => {
      if (!await memory.isAvailable()) return "ERROR: Memory layer not available";
      const limit = (args.limit as number) ?? 50;
      const entries = await memory.timeline({ entityId: args.entity_id as string, limit });
      if (entries.length === 0) return `No memories for ${args.entity_id}`;
      return [
        `Timeline for ${args.entity_id} (${await memory.count(args.entity_id as string)} total, showing ${entries.length}):`,
        ...entries.map((record) => {
          if (memory instanceof SqliteMemoryProvider) {
            return memory.formatRecord({ ref: record.ref, content: record.content });
          }
          return `[${record.ref.entity_id}] ${record.ref.created_at.slice(0, 16)}: ${record.content}`;
        }),
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
      if (!await memory.isAvailable()) return "ERROR: Memory layer not available";
      if (args.action === "record") {
        await memory.recordJournal(args.entity_id as string, args.transition as string);
        return `Recorded journal entry: ${args.entity_id} ${args.transition}`;
      }
      if (args.entity_id) {
        if (memory instanceof SqliteMemoryProvider) {
          return buildJournalSummary(memory.getStore(), [args.entity_id as string]);
        }
        const entries = await memory.getJournal({ entityId: args.entity_id as string, limit: 30 });
        if (entries.length === 0) return "(no journal entries)";
        return [
          `${args.entity_id}:`,
          ...entries.map((entry) => `  ${entry.created_at.slice(0, 16)} ${entry.transition}`),
        ].join("\n");
      }
      const entries = await memory.getAllJournal(30);
      if (entries.length === 0) return "(no journal entries)";
      return entries.map(e => `[${e.entity_id}] ${e.created_at.slice(0, 16)}: ${e.transition}`).join("\n");
    },
  },

  esr_stack_status: {
    schema: z.object({}),
    handler: async () => {
      const layers: string[] = [];

      // Layer 3: pi-esr
      const entities = graph.getAllEntities();
      const tasks = entities.filter(e => e.role === "Task");
      const stable = tasks.filter(e => e.state === "stable").length;
      const active = tasks.filter(e => e.state === "active").length;
      const artifacts = graph.getAllArtifacts().length;
      const relations = graph.getAllRelations().length;
      const memoryRefs = graph.getAllMemoryRefs().length;

      layers.push(`[pi-esr]`);
      layers.push(`  entities: ${entities.length} (tasks: ${tasks.length}, stable: ${stable}, active: ${active})`);
      layers.push(`  artifacts: ${artifacts}, relations: ${relations}, memory_refs: ${memoryRefs}`);
      layers.push(`  state snapshot: ${entities.length > 0 ? "loaded" : "fresh"}`);

      // Layer 2: pi-loom (via memory provider)
      const memAvailable = await memory.isAvailable();
      if (memAvailable) {
        const memCount = await memory.count();
        layers.push(`[pi-loom]`);
        layers.push(`  memories: ${memCount}, provider: ${memory.name}`);
      } else {
        layers.push(`[pi-loom]: not available (provider: ${memory.name})`);
      }

      // Layer 1: context-mode (not detectable from MCP side, note)
      layers.push(`[context-mode]`);
      layers.push(`  status: check ctx_stats in pi for detailed stats`);

      // Summary
      layers.push("");
      const overall = tasks.length > 0 ? `Active: ${tasks.length} tasks (${stable} stable, ${active} in progress)` : "No tasks tracked";
      layers.push(`Summary: ${overall}`);

      return layers.join("\n");
    },
  },
};

// ── Helpers ─────────────────────────────────────────────

export function isMutation(name: string): boolean {
  return !["esr_get_context", "esr_get_closure_status", "esr_list_closure_gaps", "esr_list_tasks", "esr_mem_recall", "esr_mem_timeline", "esr_mem_journal", "esr_stack_status"].includes(name);
}

export function getContextText(): string {
  return appendMemoryContext(buildESRContext(graph));
}

function appendMemoryContext(context: string): string {
  if (!(memory instanceof SqliteMemoryProvider)) return context;
  const entityIds = graph.getAllEntities().map(e => e.entity_id);
  const memCtx = buildActiveMemoryContext(memory.getStore(), entityIds);
  if (!memCtx || memCtx.includes("(no memories)")) {
    return context;
  }
  return `${context}\n\n${memCtx}`;
}
