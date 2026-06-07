/**
 * pi-esr: Tool Registrations
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { buildESRContext } from "../core/context";
import { ESRGraph } from "../core/graph";
import type { ESRPersistedState } from "../core/types";
import { persistGraph } from "../persistence/snapshot";
import { ToolDriverRegistry } from "../runtime/drivers/tool-driver";
import { ESRRuntime } from "../runtime/runtime";
import type { ExecutionNode, ExecutionResult } from "../runtime/runtime-types";
import { ESRRuntimeStateStore } from "../runtime/state";

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

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asMetricRecord(value: unknown): Record<string, number> | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  const metrics: Record<string, number> = {};
  for (const [key, metricValue] of Object.entries(record)) {
    if (typeof metricValue === "number") {
      metrics[key] = metricValue;
    }
  }
  return metrics;
}

function registerRuntimeHandlers(
  graph: ESRGraph,
  runtimeStore: ESRRuntimeStateStore,
  toolDrivers: ToolDriverRegistry,
  persistGraphFn: () => void,
): void {
  /** Called after every graph mutation: persists graph state,
   *  then invalidates dependent runtime nodes. */
  function onGraphMutated(reason: string): void {
    persistGraphFn();
    runtimeStore.invalidateDependentNodes(reason);
  }

  toolDrivers.register("esr_create_entity", async (params): Promise<ExecutionResult> => {
    const entityId = typeof params.entity_id === "string" ? params.entity_id : null;
    const role = typeof params.role === "string" ? params.role : null;
    if (!entityId || !role) return { status: "failed", error: "Invalid create_entity params" };
    const result = graph.createEntity({
      entity_id: entityId,
      role: role as never,
      state: (typeof params.state === "string" ? params.state : "draft") as never,
      confidence: typeof params.confidence === "number" ? params.confidence : 0,
      metrics: asMetricRecord(params.metrics) ?? {},
      label: typeof params.label === "string" ? params.label : undefined,
      updated_at: new Date().toISOString(),
    });
    if (!result.ok) return { status: "failed", error: result.error };
    onGraphMutated("Graph changed after entity creation");
    return { status: "succeeded", outputs: { entity_id: entityId } };
  });

  toolDrivers.register("esr_update_state", async (params): Promise<ExecutionResult> => {
    const entityId = typeof params.entity_id === "string" ? params.entity_id : null;
    if (!entityId) return { status: "failed", error: "Invalid update_state params" };
    const currentState = graph.getEntity(entityId)?.state ?? "draft";
    const state = typeof params.state === "string" ? params.state : currentState;
    const result = graph.updateEntityState(
      entityId,
      state as never,
      typeof params.confidence === "number" ? params.confidence : undefined,
      asMetricRecord(params.metrics),
    );
    if (!result.ok) return { status: "failed", error: result.error };
    onGraphMutated("Graph changed after entity update");
    return { status: "succeeded", outputs: { entity_id: entityId, state } };
  });

  toolDrivers.register("esr_link_relation", async (params): Promise<ExecutionResult> => {
    const from = typeof params.from === "string" ? params.from : null;
    const to = typeof params.to === "string" ? params.to : null;
    const type = typeof params.type === "string" ? params.type : null;
    if (!from || !to || !type) return { status: "failed", error: "Invalid link_relation params" };
    const result = graph.linkRelation(from, to, type as never);
    if (!result.ok) return { status: "failed", error: result.error };
    onGraphMutated("Graph changed after relation update");
    return { status: "succeeded", outputs: { from, to, type } };
  });

  toolDrivers.register("esr_evaluate", async (params): Promise<ExecutionResult> => {
    const entityId = typeof params.entity_id === "string" ? params.entity_id : null;
    const evaluator = typeof params.evaluator === "string" ? params.evaluator : null;
    if (!entityId || !evaluator || typeof params.confidence !== "number") {
      return { status: "failed", error: "Invalid evaluate params" };
    }
    const result = graph.evaluate(entityId, evaluator, params.confidence, asMetricRecord(params.metrics) ?? {});
    if (!result.ok) return { status: "failed", error: result.error };
    onGraphMutated("Graph changed after evaluation update");
    return { status: "succeeded", outputs: { entity_id: entityId, evaluator } };
  });

  toolDrivers.register("esr_score", async (params): Promise<ExecutionResult> => {
    const entityId = typeof params.entity_id === "string" ? params.entity_id : null;
    const scoreType = typeof params.score_type === "string" ? params.score_type : null;
    const scoreValue = typeof params.score_value === "number" ? params.score_value : null;
    if (!entityId || !scoreType || scoreValue === null) return { status: "failed", error: "Invalid score params" };
    const result = graph.score(entityId, scoreValue, scoreType);
    if (!result.ok) return { status: "failed", error: result.error };
    onGraphMutated("Graph changed after score update");
    return { status: "succeeded", outputs: { entity_id: entityId, score_type: scoreType } };
  });

  toolDrivers.register("esr_promote_task", async (params): Promise<ExecutionResult> => {
    const entityId = typeof params.entity_id === "string" ? params.entity_id : null;
    const newState = typeof params.new_state === "string" ? params.new_state : null;
    if (!entityId || !newState) return { status: "failed", error: "Invalid promote_task params" };
    const result = graph.promoteTask(entityId, newState as "active" | "stable");
    if (!result.ok) return { status: "failed", error: result.error };
    onGraphMutated("Graph changed after task promotion");
    return { status: "succeeded", outputs: { entity_id: entityId, state: newState } };
  });

  toolDrivers.register("esr_update_artifact", async (params): Promise<ExecutionResult> => {
    const id = typeof params.id === "string" ? params.id : null;
    const type = typeof params.type === "string" ? params.type : null;
    const sections = Array.isArray(params.sections) ? params.sections : null;
    if (!id || !type || !sections) return { status: "failed", error: "Invalid update_artifact params" };
    const result = graph.upsertArtifact({
      id,
      type: type as never,
      version: typeof params.version === "number" ? params.version : undefined,
      sections: sections.map(section => {
        const value = asRecord(section) ?? {};
        return {
          name: String(value.name ?? ""),
          state: String(value.state ?? "draft") as never,
        };
      }),
    });
    if (!result.ok) return { status: "failed", error: result.error };
    onGraphMutated("Graph changed after artifact update");
    return { status: "succeeded", outputs: { id } };
  });

  toolDrivers.register("esr_apply_constraint", async (params): Promise<ExecutionResult> => {
    const entityId = typeof params.entity_id === "string" ? params.entity_id : null;
    const description = typeof params.constraint_description === "string" ? params.constraint_description : null;
    if (!entityId || !description) return { status: "failed", error: "Invalid apply_constraint params" };
    const result = graph.applyConstraint(entityId, description);
    if (!result.ok) return { status: "failed", error: result.error };
    onGraphMutated("Graph changed after constraint update");
    return { status: "succeeded", outputs: { entity_id: entityId } };
  });

  toolDrivers.register("esr_remove_entity", async (params): Promise<ExecutionResult> => {
    const entityId = typeof params.entity_id === "string" ? params.entity_id : null;
    if (!entityId) return { status: "failed", error: "Invalid remove_entity params" };
    const result = graph.removeEntity(entityId);
    if (!result.ok) return { status: "failed", error: result.error };
    onGraphMutated("Graph changed after entity removal");
    return { status: "succeeded", outputs: { entity_id: entityId } };
  });

  toolDrivers.register("esr_remove_relation", async (params): Promise<ExecutionResult> => {
    const from = typeof params.from === "string" ? params.from : null;
    const to = typeof params.to === "string" ? params.to : null;
    const type = typeof params.type === "string" ? params.type : null;
    if (!from || !to || !type) return { status: "failed", error: "Invalid remove_relation params" };
    const result = graph.removeRelation(from, to, type as never);
    if (!result.ok) return { status: "failed", error: result.error };
    onGraphMutated("Graph changed after relation removal");
    return { status: "succeeded", outputs: { from, to, type } };
  });

  toolDrivers.register("esr_create_node", async (params): Promise<ExecutionResult> => {
    const nodeId = typeof params.node_id === "string" ? params.node_id : null;
    const taskEntityId = typeof params.task_entity_id === "string" ? params.task_entity_id : null;
    const kind = typeof params.kind === "string" ? params.kind : null;
    const inputs = asRecord(params.inputs);
    if (!nodeId || !taskEntityId || !kind || !inputs) return { status: "failed", error: "Invalid create_node params" };
    const node: Omit<ExecutionNode, "updated_at"> = {
      node_id: nodeId,
      task_entity_id: taskEntityId,
      kind: kind as ExecutionNode["kind"],
      state: "pending",
      inputs,
      outputs: {},
      dependencies: Array.isArray(params.dependencies) ? params.dependencies.map(String) : [],
      retry_count: 0,
      max_retries: typeof params.max_retries === "number" ? params.max_retries : 0,
      driver_version: typeof params.driver_version === "string" ? params.driver_version : "v1",
    };
    runtimeStore.createNode(node);
    return { status: "succeeded", outputs: { node_id: nodeId } };
  });
}

export function registerTools(
  pi: ExtensionAPI,
  graph: ESRGraph,
  runtimeStore: ESRRuntimeStateStore,
  toolDrivers: ToolDriverRegistry,
  runtime: ESRRuntime,
): void {
  const persistGraphFn = () => persistGraph(pi, graph);
  registerRuntimeHandlers(graph, runtimeStore, toolDrivers, persistGraphFn);

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
    async execute(_id, params) {
      const result = await toolDrivers.run("esr_create_entity", params, { graph, store: runtimeStore });
      if (result.status !== "succeeded") return errorText(result.error ?? "Unknown error");
      const entity = graph.getEntity(params.entity_id)!;
      return okText(`Created entity: ${entity.entity_id} [${entity.role}] state=${entity.state} confidence=${entity.confidence.toFixed(2)}`, { action: "create_entity", entity });
    },
  });

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
    async execute(_id, params) {
      if (!params.state && params.confidence === undefined && !params.metrics) {
        return errorText("At least one of state, confidence, or metrics required");
      }
      const result = await toolDrivers.run("esr_update_state", params, { graph, store: runtimeStore });
      if (result.status !== "succeeded") return errorText(result.error ?? "Unknown error");
      const updated = graph.getEntity(params.entity_id)!;
      return okText(`Updated entity: ${params.entity_id} state=${updated.state} confidence=${updated.confidence.toFixed(2)}`, { action: "update_state", entity: updated });
    },
  });

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
    async execute(_id, params) {
      const result = await toolDrivers.run("esr_link_relation", params, { graph, store: runtimeStore });
      if (result.status !== "succeeded") return errorText(result.error ?? "Unknown error");
      return okText(`Linked: ${params.from} --[${params.type}]--> ${params.to}`, { action: "link_relation", relation: { from: params.from, to: params.to, type: params.type } });
    },
  });

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
    async execute(_id, params) {
      const result = await toolDrivers.run("esr_evaluate", params, { graph, store: runtimeStore });
      if (result.status !== "succeeded") return errorText(result.error ?? "Unknown error");
      return okText(`Evaluated: ${params.entity_id} by ${params.evaluator} confidence=${params.confidence.toFixed(2)}`, { action: "evaluate", entity: graph.getEntity(params.entity_id) });
    },
  });

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
    async execute(_id, params) {
      const result = await toolDrivers.run("esr_score", params, { graph, store: runtimeStore });
      if (result.status !== "succeeded") return errorText(result.error ?? "Unknown error");
      return okText(`Scored: ${params.entity_id} ${params.score_type}=${params.score_value}`, { action: "score", entity: graph.getEntity(params.entity_id) });
    },
  });

  pi.registerTool({
    name: "esr_promote_task",
    label: "ESR Promote Task",
    description: "Promote a Task entity to 'active' or 'stable' state.",
    promptSnippet: "Promote a task entity to active or stable state",
    parameters: Type.Object({
      entity_id: Type.String({ description: "Task entity to promote" }),
      new_state: StringEnum(["active", "stable"] as const),
    }),
    async execute(_id, params) {
      const result = await toolDrivers.run("esr_promote_task", params, { graph, store: runtimeStore });
      if (result.status !== "succeeded") return errorText(result.error ?? "Unknown error");
      return okText(`Promoted task: ${params.entity_id} -> ${params.new_state}`, { action: "promote_task", entity: graph.getEntity(params.entity_id) });
    },
  });

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
    async execute(_id, params) {
      const result = await toolDrivers.run("esr_update_artifact", params, { graph, store: runtimeStore });
      if (result.status !== "succeeded") return errorText(result.error ?? "Unknown error");
      const artifact = graph.getArtifact(params.id)!;
      return okText(`Updated artifact: ${artifact.id} [${artifact.type}] v${artifact.version} (${artifact.sections.length} sections)`, { action: "update_artifact", artifact });
    },
  });

  pi.registerTool({
    name: "esr_apply_constraint",
    label: "ESR Apply Constraint",
    description: "Apply a constraint to an entity.",
    promptSnippet: "Apply a constraint to an entity",
    parameters: Type.Object({
      entity_id: Type.String({ description: "Entity the constraint applies to" }),
      constraint_description: Type.String({ description: "Description of the constraint" }),
    }),
    async execute(_id, params) {
      const result = await toolDrivers.run("esr_apply_constraint", params, { graph, store: runtimeStore });
      if (result.status !== "succeeded") return errorText(result.error ?? "Unknown error");
      return okText(`Applied constraint to ${params.entity_id}: ${params.constraint_description}`, { action: "apply_constraint", description: params.constraint_description });
    },
  });

  pi.registerTool({
    name: "esr_get_context",
    label: "ESR Get Context",
    description: "Query the current ESR graph state.",
    promptSnippet: "Query the current ESR graph state",
    parameters: Type.Object({}),
    async execute() {
      const context = buildESRContext(graph);
      return {
        content: [{ type: "text", text: context }],
        details: graph.toPersistedState() satisfies ESRPersistedState,
      };
    },
    renderResult(result, _options, theme) {
      const first = result.content?.[0];
      return new Text(first?.type === "text" ? first.text : theme.fg("dim", "(empty ESR graph)"), 0, 0);
    },
  });

  pi.registerTool({
    name: "esr_remove_entity",
    label: "ESR Remove Entity",
    description: "Remove an entity and all its relations from the ESR graph.",
    promptSnippet: "Remove an entity from the ESR state graph",
    parameters: Type.Object({
      entity_id: Type.String({ description: "Entity ID to remove" }),
    }),
    async execute(_id, params) {
      const result = await toolDrivers.run("esr_remove_entity", params, { graph, store: runtimeStore });
      if (result.status !== "succeeded") return errorText(result.error ?? "Unknown error");
      return okText(`Removed entity: ${params.entity_id} (relations cascade-deleted)`, { action: "remove_entity", entity_id: params.entity_id });
    },
  });

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
    async execute(_id, params) {
      const result = await toolDrivers.run("esr_remove_relation", params, { graph, store: runtimeStore });
      if (result.status !== "succeeded") return errorText(result.error ?? "Unknown error");
      return okText(`Removed relation: ${params.from} --[${params.type}]--> ${params.to}`, { action: "remove_relation", relation: { from: params.from, to: params.to, type: params.type } });
    },
  });

  pi.registerTool({
    name: "esr_create_node",
    label: "ESR Create Node",
    description: "Create a runtime execution node for ESR tick/run commands.",
    promptSnippet: "Create a runtime execution node",
    parameters: Type.Object({
      node_id: Type.String({ description: "Execution node ID" }),
      task_entity_id: Type.String({ description: "Associated Task entity ID" }),
      kind: StringEnum(["tool"] as const),
      inputs: Type.Record(Type.String(), Type.Unknown(), { description: "Execution input payload" }),
      dependencies: Type.Optional(Type.Array(Type.String(), { description: "Upstream node IDs" })),
      max_retries: Type.Optional(Type.Number({ description: "Maximum retries" })),
      driver_version: Type.Optional(Type.String({ description: "Driver version string" })),
    }),
    async execute(_id, params) {
      const result = await toolDrivers.run("esr_create_node", params, { graph, store: runtimeStore });
      if (result.status !== "succeeded") return errorText(result.error ?? "Unknown error");
      return okText(`Created runtime node: ${params.node_id} kind=${params.kind}`, {
        action: "create_node",
        node: runtimeStore.getNode(params.node_id),
      });
    },
  });

  pi.registerTool({
    name: "esr_run",
    label: "ESR Run",
    description: "Execute all pending runtime nodes until idle. Call this after declaring a DAG with esr_create_node. Execution is zero-token — the runtime engine handles dependency ordering, caching, and parallel dispatch automatically.",
    promptSnippet: "Execute pending runtime nodes",
    parameters: Type.Object({
      max_steps: Type.Optional(Type.Number({ description: "Max ticks (default 100)" })),
    }),
    async execute(_id, params) {
      const maxSteps = typeof params.max_steps === "number" ? params.max_steps : 100;
      const results = await runtime.runUntilIdle(maxSteps);
      const succeeded = results.filter(r => r.status === "executed" || r.status === "cached").length;
      const failed = results.filter(r => r.status === "failed").length;
      const last = results[results.length - 1];
      return okText(
        `Runtime complete: ${succeeded} succeeded, ${failed} failed, ${results.length} total. Final: ${last?.status ?? "idle"}`,
        { action: "esr_run", results },
      );
    },
  });
}
