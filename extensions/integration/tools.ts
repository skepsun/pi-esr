/**
 * pi-esr: Pi Tool Registrations — 11 graph tools
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { buildPackApplyPlan, createBuiltinPackRegistry, detectBestPack } from "../../packages/domain-pack/src/index.js";
import {
  ESRGraph,
  buildESRContext,
  getClosureStatus,
  listClosureGaps,
  listTasks,
} from "../core";
import type { ESRPersistedState } from "../core";
import { persistGraph } from "../persistence/snapshot";

function okText(text: string, details: Record<string, unknown>) {
  return {
    content: [{ type: "text" as const, text }],
    details,
  };
}

function errorText(error: string) {
  return {
    content: [{ type: "text" as const, text: `ERROR: ${error}` }],
    details: { error },
  };
}

export function registerTools(
  pi: ExtensionAPI,
  graph: ESRGraph,
): void {
  const persistGraphFn = () => persistGraph(pi, graph);
  const packRegistry = createBuiltinPackRegistry();
  const packs = packRegistry.list();

  // ── esr_create_entity ──────────────────────────────────

  pi.registerTool({
    name: "esr_create_entity",
    label: "ESR Create Entity",
    description: "Create a new entity in the ESR graph.",
    promptSnippet: "Create a new entity in the ESR state graph",
    parameters: Type.Object({
      entity_id: Type.String({ description: "Unique identifier for this entity" }),
      role: StringEnum(["Actor", "Artifact", "Task", "Concept", "Constraint"] as const),
      label: Type.Optional(Type.String({ description: "Human-readable label" })),
      state: Type.Optional(StringEnum(["active", "stable", "draft", "blocked", "deprecated"] as const)),
      confidence: Type.Optional(Type.Number({ description: "Confidence 0.0-1.0, default 0" })),
      metrics: Type.Optional(Type.Record(Type.String(), Type.Number(), { description: "Key-value numeric metrics" })),
    }),
    async execute(_id, params: any) {
      const r = graph.createEntity({
        entity_id: params.entity_id,
        role: params.role,
        state: params.state ?? "draft",
        confidence: params.confidence ?? 0,
        metrics: params.metrics ?? {},
        label: params.label,
        updated_at: new Date().toISOString(),
      });
      if (!r.ok) return errorText(r.error);
      persistGraphFn();
      const entity = graph.getEntity(params.entity_id)!;
      return okText(`Created entity: ${entity.entity_id} [${entity.role}] state=${entity.state} confidence=${entity.confidence.toFixed(2)}`, { action: "create_entity", entity });
    },
  });

  // ── esr_update_state ───────────────────────────────────

  pi.registerTool({
    name: "esr_update_state",
    label: "ESR Update State",
    description: "Update an entity's state, confidence, or metrics.",
    promptSnippet: "Update entity state, confidence, or metrics in the ESR graph",
    parameters: Type.Object({
      entity_id: Type.String({ description: "Entity to update" }),
      state: Type.Optional(StringEnum(["active", "stable", "draft", "blocked", "deprecated"] as const)),
      confidence: Type.Optional(Type.Number({ description: "New confidence 0.0-1.0" })),
      metrics: Type.Optional(Type.Record(Type.String(), Type.Number(), { description: "Metrics to merge" })),
    }),
    async execute(_id, params: any) {
      if (!params.state && params.confidence === undefined && !params.metrics) {
        return errorText("At least one of state, confidence, or metrics required");
      }
      const current = graph.getEntity(params.entity_id);
      if (!current) return errorText(`Entity not found: ${params.entity_id}`);
      const targetState = params.state ?? current.state;
      const r = graph.updateEntityState(params.entity_id, targetState, params.confidence, params.metrics);
      if (!r.ok) return errorText(r.error);
      persistGraphFn();
      const updated = graph.getEntity(params.entity_id)!;
      return okText(`Updated entity: ${params.entity_id} state=${updated.state} confidence=${updated.confidence.toFixed(2)}`, { action: "update_state", entity: updated });
    },
  });

  // ── esr_link_relation ──────────────────────────────────

  pi.registerTool({
    name: "esr_link_relation",
    label: "ESR Link Relation",
    description: "Create a typed relation between two entities.",
    promptSnippet: "Create a typed relation between two entities in the ESR graph",
    parameters: Type.Object({
      from: Type.String({ description: "Source entity ID" }),
      to: Type.String({ description: "Target entity ID" }),
      type: StringEnum(["depends_on", "part_of", "implements", "supports", "contradicts", "refines", "evaluates", "scores", "validates", "triggers", "updates", "blocks", "produces"] as const),
    }),
    async execute(_id, params: any) {
      const r = graph.linkRelation(params.from, params.to, params.type);
      if (!r.ok) return errorText(r.error);
      persistGraphFn();
      return okText(`Linked: ${params.from} --[${params.type}]--> ${params.to}`, { action: "link_relation", relation: { from: params.from, to: params.to, type: params.type } });
    },
  });

  // ── esr_evaluate ───────────────────────────────────────

  pi.registerTool({
    name: "esr_evaluate",
    label: "ESR Evaluate",
    description: "Record an evaluation against an entity from an evaluator entity.",
    promptSnippet: "Record an evaluation against an entity with confidence and metrics",
    parameters: Type.Object({
      entity_id: Type.String({ description: "Entity being evaluated" }),
      evaluator: Type.String({ description: "Evaluator entity ID" }),
      confidence: Type.Number({ description: "Confidence score 0.0-1.0" }),
      metrics: Type.Optional(Type.Record(Type.String(), Type.Number(), { description: "Evaluation metrics" })),
    }),
    async execute(_id, params: any) {
      const r = graph.evaluate(params.entity_id, params.evaluator, params.confidence, params.metrics ?? {});
      if (!r.ok) return errorText(r.error);
      persistGraphFn();
      return okText(`Evaluated: ${params.entity_id} by ${params.evaluator} confidence=${params.confidence.toFixed(2)}`, { action: "evaluate", entity: graph.getEntity(params.entity_id) });
    },
  });

  // ── esr_score ──────────────────────────────────────────

  pi.registerTool({
    name: "esr_score",
    label: "ESR Score",
    description: "Attach a numeric score to an entity under a named metric key.",
    promptSnippet: "Attach a numeric score to an entity",
    parameters: Type.Object({
      entity_id: Type.String({ description: "Entity to score" }),
      score_value: Type.Number({ description: "Numeric score value" }),
      score_type: Type.String({ description: "Metric name" }),
    }),
    async execute(_id, params: any) {
      const r = graph.score(params.entity_id, params.score_value, params.score_type);
      if (!r.ok) return errorText(r.error);
      persistGraphFn();
      return okText(`Scored: ${params.entity_id} ${params.score_type}=${params.score_value}`, { action: "score", entity: graph.getEntity(params.entity_id) });
    },
  });

  // ── esr_promote_task ───────────────────────────────────

  pi.registerTool({
    name: "esr_promote_task",
    label: "ESR Promote Task",
    description: "Promote a Task entity to 'active' or 'stable' state.",
    promptSnippet: "Promote a task entity to active or stable state",
    parameters: Type.Object({
      entity_id: Type.String({ description: "Task entity to promote" }),
      new_state: StringEnum(["active", "stable"] as const),
    }),
    async execute(_id, params: any) {
      const r = graph.promoteTask(params.entity_id, params.new_state);
      if (!r.ok) return errorText(r.error);
      persistGraphFn();
      return okText(`Promoted task: ${params.entity_id} -> ${params.new_state}`, { action: "promote_task", entity: graph.getEntity(params.entity_id) });
    },
  });

  // ── esr_update_artifact ────────────────────────────────

  pi.registerTool({
    name: "esr_update_artifact",
    label: "ESR Update Artifact",
    description: "Create or update a structured artifact with versioned sections.",
    promptSnippet: "Create or update a structured artifact with versioned sections",
    parameters: Type.Object({
      id: Type.String({ description: "Artifact identifier" }),
      type: StringEnum(["document", "code", "report", "spec"] as const),
      version: Type.Optional(Type.Number({ description: "Version number" })),
      sections: Type.Array(Type.Object({
        name: Type.String(),
        state: StringEnum(["draft", "editing", "stable", "invalid"] as const),
      })),
    }),
    async execute(_id, params: any) {
      const r = graph.upsertArtifact({
        id: params.id,
        type: params.type,
        version: params.version,
        sections: params.sections.map((s: any) => ({ name: s.name, state: s.state })),
      });
      if (!r.ok) return errorText(r.error);
      persistGraphFn();
      const artifact = graph.getArtifact(params.id)!;
      return okText(`Updated artifact: ${artifact.id} [${artifact.type}] v${artifact.version} (${artifact.sections.length} sections)`, { action: "update_artifact", artifact });
    },
  });

  // ── esr_apply_constraint ───────────────────────────────

  pi.registerTool({
    name: "esr_apply_constraint",
    label: "ESR Apply Constraint",
    description: "Apply a constraint to an entity.",
    promptSnippet: "Apply a constraint to an entity",
    parameters: Type.Object({
      entity_id: Type.String({ description: "Entity the constraint applies to" }),
      constraint_description: Type.String({ description: "Description of the constraint" }),
    }),
    async execute(_id, params: any) {
      const r = graph.applyConstraint(params.entity_id, params.constraint_description);
      if (!r.ok) return errorText(r.error);
      persistGraphFn();
      return okText(`Applied constraint to ${params.entity_id}: ${params.constraint_description}`, { action: "apply_constraint", description: params.constraint_description });
    },
  });

  // ── esr_get_context ────────────────────────────────────

  pi.registerTool({
    name: "esr_get_context",
    label: "ESR Get Context",
    description: "Query the current ESR graph state. Pass since_revision=N to skip unchanged state (10 tokens vs full).",
    promptSnippet: "Query the current ESR graph state",
    parameters: Type.Object({
      since_revision: Type.Optional(Type.Integer({ description: "Skip output if graph version matches this revision" })),
    }),
    async execute(_id, params: any) {
      const sinceRevision = typeof params.since_revision === "number" ? params.since_revision : undefined;
      const context = buildESRContext(graph, { sinceRevision });
      return {
        content: [{ type: "text", text: context }],
        details: graph.toPersistedState() satisfies ESRPersistedState,
      };
    },
    renderResult(result: any, _options: any, theme: any) {
      const first = result.content?.[0];
      return new Text(first?.type === "text" ? first.text : theme.fg("dim", "(empty ESR graph)"), 0, 0);
    },
  });

  // ── esr_detect_pack ───────────────────────────────────

  pi.registerTool({
    name: "esr_detect_pack",
    label: "ESR Detect Pack",
    description: "Detect the best-matching domain pack for a goal or prompt.",
    promptSnippet: "Detect the most suitable ESR domain pack",
    parameters: Type.Object({
      prompt: Type.String({ description: "User goal or task description" }),
    }),
    async execute(_id, params: any) {
      const result = await detectBestPack(packs, {
        prompt: params.prompt,
        cwd: process.cwd(),
        host: "pi",
      });
      if (!result.pack) {
        return okText("No matching domain pack found.", {
          action: "detect_pack",
          score: 0,
          pack: null,
        });
      }
      return okText(`Detected pack: ${result.pack.name} score=${result.score.toFixed(2)}`, {
        action: "detect_pack",
        score: result.score,
        pack: {
          name: result.pack.name,
          version: result.pack.version,
          description: result.pack.description,
        },
      });
    },
  });

  // ── esr_list_packs ────────────────────────────────────

  pi.registerTool({
    name: "esr_list_packs",
    label: "ESR List Packs",
    description: "List built-in domain packs available to ESR.",
    promptSnippet: "List ESR domain packs",
    parameters: Type.Object({}),
    async execute() {
      const packList = packRegistry.list();
      const text = [
        `Available packs (${packList.length}):`,
        ...packList.map((pack) => `- ${pack.name}@${pack.version}${pack.description ? `: ${pack.description}` : ""}`),
      ].join("\n");
      return okText(text, {
        action: "list_packs",
        count: packList.length,
        packs: packList.map((pack) => ({
          name: pack.name,
          version: pack.version,
          description: pack.description,
        })),
      });
    },
  });

  // ── esr_expand_with_pack ──────────────────────────────

  pi.registerTool({
    name: "esr_expand_with_pack",
    label: "ESR Expand With Pack",
    description: "Expand a goal through a domain pack and map the result into ESR state.",
    promptSnippet: "Expand a goal using an ESR domain pack",
    parameters: Type.Object({
      goal: Type.String({ description: "Goal to expand into ESR structure" }),
      pack_name: Type.Optional(Type.String({ description: "Optional explicit pack name" })),
    }),
    async execute(_id, params: any) {
      const pack = params.pack_name
        ? packs.find((item) => item.name === params.pack_name)
        : (await detectBestPack(packs, {
          prompt: params.goal,
          cwd: process.cwd(),
          host: "pi",
        })).pack;
      if (!pack) {
        return errorText(`Pack not found: ${params.pack_name ?? "(auto)"}`);
      }

      const expansion = await pack.expand({
        goal: params.goal,
        cwd: process.cwd(),
      });
      const validation = await pack.validate({
        context: `${params.goal}\n${buildESRContext(graph)}`,
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
          return errorText(result.error);
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
        if (!result.ok) return errorText(result.error);
      }

      for (const relation of plan.relations) {
        const result = graph.linkRelation(relation.from, relation.to, relation.type);
        if (!result.ok && !result.error.includes("already exists")) {
          return errorText(result.error);
        }
      }

      for (const constraint of plan.constraints) {
        const result = graph.applyConstraint(constraint.entity_id, constraint.description);
        if (!result.ok) return errorText(result.error);
      }

      for (const evaluation of plan.evaluations) {
        const result = graph.evaluate(
          evaluation.entity_id,
          evaluation.evaluator,
          evaluation.confidence,
          evaluation.metrics ?? {},
        );
        if (!result.ok) return errorText(result.error);
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
          return errorText(result.error);
        }
      }

      persistGraphFn();
      return okText(`Expanded with pack: ${pack.name}`, {
        action: "expand_with_pack",
        pack: pack.name,
        summary: plan.summary,
        entities: plan.entities.length,
        relations: plan.relations.length,
        artifacts: plan.artifacts.length,
        constraints: plan.constraints.length,
        checks: plan.checks,
        reference_baselines: plan.referenceBaselines,
        baseline_diffs: plan.baselineDiffs,
        review_findings: plan.reviewFindings,
        remediation_items: plan.remediationItems,
        gaps: plan.gaps,
      });
    },
  });

  // ── esr_get_closure_status ────────────────────────────

  pi.registerTool({
    name: "esr_get_closure_status",
    label: "ESR Get Closure Status",
    description: "Inspect whether a task is ready to be promoted to stable.",
    promptSnippet: "Check ESR task closure status and missing evidence",
    parameters: Type.Object({
      task_id: Type.String({ description: "Task entity to inspect" }),
      require_memory_ref_for_stable: Type.Optional(
        Type.Boolean({ description: "Require attached memory references before stable" }),
      ),
    }),
    async execute(_id, params: any) {
      const status = getClosureStatus(graph, params.task_id, {
        policy: {
          require_memory_ref_for_stable: params.require_memory_ref_for_stable ?? false,
        },
      });
      if (!status.task_exists) {
        return errorText(`Task not found: ${params.task_id}`);
      }
      const summary = status.ready_for_stable
        ? `Closure ready: ${params.task_id} can be promoted to stable`
        : `Closure blocked: ${params.task_id} missing ${status.missing.join(", ")}`;
      return okText(summary, {
        action: "get_closure_status",
        closure: status,
      });
    },
  });

  // ── esr_attach_memory_ref ─────────────────────────────

  pi.registerTool({
    name: "esr_attach_memory_ref",
    label: "ESR Attach Memory Ref",
    description: "Attach an external memory reference to an ESR entity without duplicating its full content.",
    promptSnippet: "Attach external memory reference to ESR entity",
    parameters: Type.Object({
      entity_id: Type.String({ description: "Entity to attach the memory reference to" }),
      ref_id: Type.String({ description: "External memory reference ID" }),
      provider: Type.String({ description: "Memory provider name, e.g. claude-mem or pi-memory" }),
      kind: StringEnum(["summary", "decision", "incident", "note"] as const),
      title: Type.Optional(Type.String({ description: "Short human-readable title" })),
      created_at: Type.Optional(Type.String({ description: "Creation timestamp in ISO 8601 format" })),
    }),
    async execute(_id, params: any) {
      const result = graph.attachMemoryRef(params.entity_id, {
        ref_id: params.ref_id,
        provider: params.provider,
        entity_id: params.entity_id,
        kind: params.kind,
        title: params.title,
        created_at: params.created_at ?? new Date().toISOString(),
      });
      if (!result.ok) return errorText(result.error);
      persistGraphFn();
      return okText(`Attached memory ref ${params.provider}:${params.ref_id} to ${params.entity_id}`, {
        action: "attach_memory_ref",
        entity_id: params.entity_id,
        ref_id: params.ref_id,
        provider: params.provider,
      });
    },
  });

  // ── esr_list_closure_gaps ─────────────────────────────

  pi.registerTool({
    name: "esr_list_closure_gaps",
    label: "ESR List Closure Gaps",
    description: "List tasks that are not yet ready to be promoted to stable.",
    promptSnippet: "List ESR tasks with missing closure evidence",
    parameters: Type.Object({
      include_ready: Type.Optional(
        Type.Boolean({ description: "Also include tasks that are already ready for stable" }),
      ),
    }),
    async execute(_id, params: any) {
      const items = listClosureGaps(graph, {
        includeReady: params.include_ready ?? false,
      });
      if (items.length === 0) {
        return okText("No closure gaps found.", {
          action: "list_closure_gaps",
          count: 0,
          items: [],
        });
      }
      const text = [
        `Closure gaps (${items.length}):`,
        ...items.map((item) => {
          const suffix = item.ready_for_stable ? "ready" : `missing ${item.missing.join(", ")}`;
          return `- ${item.task_id}${item.label ? ` (${item.label})` : ""}: ${suffix}`;
        }),
      ].join("\n");
      return okText(text, {
        action: "list_closure_gaps",
        count: items.length,
        items,
      });
    },
  });

  // ── esr_list_tasks ────────────────────────────────────

  pi.registerTool({
    name: "esr_list_tasks",
    label: "ESR List Tasks",
    description: "List task entities with state, closure readiness, and memory-ref status.",
    promptSnippet: "List ESR tasks with status and closure summary",
    parameters: Type.Object({
      state: Type.Optional(StringEnum(["active", "stable", "draft", "blocked", "deprecated"] as const)),
      include_ready: Type.Optional(
        Type.Boolean({ description: "Include tasks already ready for stable" }),
      ),
      require_memory_ref_for_stable: Type.Optional(
        Type.Boolean({ description: "Treat missing memory refs as a closure gap" }),
      ),
    }),
    async execute(_id, params: any) {
      const items = listTasks(graph, {
        state: params.state,
        includeReady: params.include_ready ?? true,
        policy: {
          require_memory_ref_for_stable: params.require_memory_ref_for_stable ?? false,
        },
      });
      if (items.length === 0) {
        return okText("No tasks found.", {
          action: "list_tasks",
          count: 0,
          items: [],
        });
      }
      const text = [
        `Tasks (${items.length}):`,
        ...items.map((item) => {
          const closure = item.ready_for_stable ? "ready" : `missing ${item.missing.join(", ")}`;
          return `- ${item.task_id}${item.label ? ` (${item.label})` : ""}: state=${item.task_state} confidence=${item.confidence.toFixed(2)} closure=${closure} memory_refs=${item.memory_ref_ids.length}`;
        }),
      ].join("\n");
      return okText(text, {
        action: "list_tasks",
        count: items.length,
        items,
      });
    },
  });

  // ── esr_remove_entity ──────────────────────────────────

  pi.registerTool({
    name: "esr_remove_entity",
    label: "ESR Remove Entity",
    description: "Remove an entity and all its relations from the ESR graph.",
    promptSnippet: "Remove an entity from the ESR state graph",
    parameters: Type.Object({
      entity_id: Type.String({ description: "Entity ID to remove" }),
    }),
    async execute(_id, params: any) {
      const r = graph.removeEntity(params.entity_id);
      if (!r.ok) return errorText(r.error);
      persistGraphFn();
      return okText(`Removed entity: ${params.entity_id} (relations cascade-deleted)`, { action: "remove_entity", entity_id: params.entity_id });
    },
  });

  // ── esr_remove_relation ────────────────────────────────

  pi.registerTool({
    name: "esr_remove_relation",
    label: "ESR Remove Relation",
    description: "Remove a specific relation between two entities.",
    promptSnippet: "Remove a relation from the ESR state graph",
    parameters: Type.Object({
      from: Type.String({ description: "Source entity ID" }),
      to: Type.String({ description: "Target entity ID" }),
      type: StringEnum(["depends_on", "part_of", "implements", "supports", "contradicts", "refines", "evaluates", "scores", "validates", "triggers", "updates", "blocks", "produces"] as const),
    }),
    async execute(_id, params: any) {
      const r = graph.removeRelation(params.from, params.to, params.type);
      if (!r.ok) return errorText(r.error);
      persistGraphFn();
      return okText(`Removed relation: ${params.from} --[${params.type}]--> ${params.to}`, { action: "remove_relation", relation: { from: params.from, to: params.to, type: params.type } });
    },
  });
}
