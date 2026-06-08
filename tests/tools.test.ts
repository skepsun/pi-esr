import { describe, expect, it } from "vitest";
import { ESRGraph } from "@pi-esr/core";
import { ToolDriverRegistry } from "@pi-esr/core";
import { ESRRuntimeStateStore } from "@pi-esr/core";
import { selectNextNode } from "@pi-esr/core";
import { buildRuntimeContext } from "@pi-esr/core";

function makeEntity(graph: ESRGraph, id: string, overrides: Record<string, unknown> = {}) {
  return graph.createEntity({
    entity_id: id,
    role: "Concept" as const,
    state: "draft" as const,
    confidence: 1.0,
    metrics: {},
    updated_at: new Date().toISOString(),
    ...overrides,
  });
}

function makeDriverRegistry(graph: ESRGraph, store: ESRRuntimeStateStore): ToolDriverRegistry {
  const drivers = new ToolDriverRegistry();
  const ctx = { graph, store };
  void ctx; // referenced by closure

  drivers.register("esr_create_entity", async (params) => {
    const result = graph.createEntity({
      entity_id: String(params.entity_id),
      role: String(params.role) as never,
      state: (typeof params.state === "string" ? params.state : "draft") as never,
      confidence: typeof params.confidence === "number" ? params.confidence : 0,
      metrics: params.metrics && typeof params.metrics === "object" && !Array.isArray(params.metrics)
        ? Object.fromEntries(
            Object.entries(params.metrics as Record<string, unknown>)
              .filter(([, v]) => typeof v === "number")
              .map(([k, v]) => [k, v as number]),
          )
        : {},
      label: typeof params.label === "string" ? params.label : undefined,
      updated_at: new Date().toISOString(),
    });
    if (!result.ok) return { status: "failed", error: result.error };
    return { status: "succeeded", outputs: { entity_id: params.entity_id } };
  });

  drivers.register("esr_update_state", async (params) => {
    const entityId = String(params.entity_id);
    if (!graph.getEntity(entityId)) return { status: "failed", error: `Entity not found: ${entityId}` };
    const result = graph.updateEntityState(
      entityId,
      String(params.state ?? "draft") as never,
      typeof params.confidence === "number" ? params.confidence : undefined,
      undefined,
    );
    if (!result.ok) return { status: "failed", error: result.error };
    return { status: "succeeded", outputs: { entity_id: entityId, state: params.state } };
  });

  drivers.register("esr_link_relation", async (params) => {
    const result = graph.linkRelation(
      String(params.from),
      String(params.to),
      String(params.type) as never,
    );
    if (!result.ok) return { status: "failed", error: result.error };
    return { status: "succeeded", outputs: { from: params.from, to: params.to, type: params.type } };
  });

  drivers.register("esr_evaluate", async (params) => {
    const result = graph.evaluate(
      String(params.entity_id),
      String(params.evaluator),
      Number(params.confidence),
      {},
    );
    if (!result.ok) return { status: "failed", error: result.error };
    return { status: "succeeded", outputs: { entity_id: params.entity_id } };
  });

  drivers.register("esr_score", async (params) => {
    const result = graph.score(String(params.entity_id), Number(params.score_value), String(params.score_type));
    if (!result.ok) return { status: "failed", error: result.error };
    return { status: "succeeded", outputs: { entity_id: params.entity_id } };
  });

  drivers.register("esr_promote_task", async (params) => {
    const result = graph.promoteTask(String(params.entity_id), String(params.new_state) as "active" | "stable");
    if (!result.ok) return { status: "failed", error: result.error };
    return { status: "succeeded", outputs: { entity_id: params.entity_id, state: params.new_state } };
  });

  drivers.register("esr_update_artifact", async (params) => {
    const sections = Array.isArray(params.sections) ? params.sections : [];
    const result = graph.upsertArtifact({
      id: String(params.id),
      type: String(params.type) as never,
      version: typeof params.version === "number" ? params.version : undefined,
      sections: sections.map((s: unknown) => {
        const sec = s as Record<string, unknown>;
        return { name: String(sec.name ?? ""), state: String(sec.state ?? "draft") as never };
      }),
    });
    if (!result.ok) return { status: "failed", error: result.error };
    return { status: "succeeded", outputs: { id: params.id } };
  });

  drivers.register("esr_apply_constraint", async (params) => {
    const result = graph.applyConstraint(String(params.entity_id), String(params.constraint_description));
    if (!result.ok) return { status: "failed", error: result.error };
    return { status: "succeeded", outputs: { entity_id: params.entity_id } };
  });

  drivers.register("esr_remove_entity", async (params) => {
    const result = graph.removeEntity(String(params.entity_id));
    if (!result.ok) return { status: "failed", error: result.error };
    return { status: "succeeded", outputs: { entity_id: params.entity_id } };
  });

  drivers.register("esr_remove_relation", async (params) => {
    const result = graph.removeRelation(
      String(params.from),
      String(params.to),
      String(params.type) as never,
    );
    if (!result.ok) return { status: "failed", error: result.error };
    return { status: "succeeded", outputs: { from: params.from, to: params.to, type: params.type } };
  });

  return drivers;
}

// ═══════════════════════════════════════════════════════════
// Tool Driver Integration Tests
// ═══════════════════════════════════════════════════════════

describe("esr_create_entity driver", () => {
  it("creates an entity through the driver", async () => {
    const graph = new ESRGraph();
    const store = new ESRRuntimeStateStore();
    const drivers = makeDriverRegistry(graph, store);
    const result = await drivers.run("esr_create_entity", { entity_id: "e1", role: "Concept" }, { graph, store });
    expect(result.status).toBe("succeeded");
    expect(graph.getEntity("e1")?.entity_id).toBe("e1");
  });

  it("rejects duplicate entity", async () => {
    const graph = new ESRGraph();
    const store = new ESRRuntimeStateStore();
    const drivers = makeDriverRegistry(graph, store);
    await drivers.run("esr_create_entity", { entity_id: "e1", role: "Concept" }, { graph, store });
    const result = await drivers.run("esr_create_entity", { entity_id: "e1", role: "Concept" }, { graph, store });
    expect(result.status).toBe("failed");
  });

  it("rejects unregistered tool name", async () => {
    const graph = new ESRGraph();
    const store = new ESRRuntimeStateStore();
    const drivers = makeDriverRegistry(graph, store);
    const result = await drivers.run("nonexistent_tool", {}, { graph, store });
    expect(result.status).toBe("failed");
    expect(result.error).toContain("No runtime handler");
  });
});

describe("esr_update_state driver", () => {
  it("transitions entity state", async () => {
    const graph = new ESRGraph();
    makeEntity(graph, "e1");
    const store = new ESRRuntimeStateStore();
    const drivers = makeDriverRegistry(graph, store);
    const result = await drivers.run("esr_update_state", { entity_id: "e1", state: "active" }, { graph, store });
    expect(result.status).toBe("succeeded");
    expect(graph.getEntity("e1")?.state).toBe("active");
  });

  it("rejects invalid transition", async () => {
    const graph = new ESRGraph();
    makeEntity(graph, "e1", { state: "stable" });
    const store = new ESRRuntimeStateStore();
    const drivers = makeDriverRegistry(graph, store);
    const result = await drivers.run("esr_update_state", { entity_id: "e1", state: "draft" }, { graph, store });
    expect(result.status).toBe("failed");
    expect(result.error).toContain("Invalid transition");
  });

  it("rejects unknown entity", async () => {
    const graph = new ESRGraph();
    const store = new ESRRuntimeStateStore();
    const drivers = makeDriverRegistry(graph, store);
    const result = await drivers.run("esr_update_state", { entity_id: "nope", state: "active" }, { graph, store });
    expect(result.status).toBe("failed");
  });
});

describe("esr_link_relation driver", () => {
  it("creates a relation", async () => {
    const graph = new ESRGraph();
    makeEntity(graph, "a");
    makeEntity(graph, "b");
    const store = new ESRRuntimeStateStore();
    const drivers = makeDriverRegistry(graph, store);
    const result = await drivers.run("esr_link_relation", { from: "a", to: "b", type: "depends_on" }, { graph, store });
    expect(result.status).toBe("succeeded");
    expect(graph.getAllRelations()).toHaveLength(1);
  });

  it("rejects duplicate relation", async () => {
    const graph = new ESRGraph();
    makeEntity(graph, "a");
    makeEntity(graph, "b");
    const store = new ESRRuntimeStateStore();
    const drivers = makeDriverRegistry(graph, store);
    await drivers.run("esr_link_relation", { from: "a", to: "b", type: "depends_on" }, { graph, store });
    const result = await drivers.run("esr_link_relation", { from: "a", to: "b", type: "depends_on" }, { graph, store });
    expect(result.status).toBe("failed");
  });

  it("rejects relation with missing entities", async () => {
    const graph = new ESRGraph();
    makeEntity(graph, "a");
    const store = new ESRRuntimeStateStore();
    const drivers = makeDriverRegistry(graph, store);
    const result = await drivers.run("esr_link_relation", { from: "a", to: "b", type: "depends_on" }, { graph, store });
    expect(result.status).toBe("failed");
  });
});

describe("esr_evaluate driver", () => {
  it("records evaluation", async () => {
    const graph = new ESRGraph();
    makeEntity(graph, "eval", { role: "Actor" });
    makeEntity(graph, "target");
    const store = new ESRRuntimeStateStore();
    const drivers = makeDriverRegistry(graph, store);
    const result = await drivers.run("esr_evaluate", { entity_id: "target", evaluator: "eval", confidence: 0.85 }, { graph, store });
    expect(result.status).toBe("succeeded");
    expect(graph.getEntity("target")?.confidence).toBe(0.85);
    expect(graph.getAllRelations()).toHaveLength(1);
  });
});

describe("esr_score driver", () => {
  it("attaches a score", async () => {
    const graph = new ESRGraph();
    makeEntity(graph, "e1");
    const store = new ESRRuntimeStateStore();
    const drivers = makeDriverRegistry(graph, store);
    const result = await drivers.run("esr_score", { entity_id: "e1", score_value: 0.7, score_type: "quality" }, { graph, store });
    expect(result.status).toBe("succeeded");
    expect(graph.getEntity("e1")?.metrics.quality).toBe(0.7);
  });
});

describe("esr_promote_task driver", () => {
  it("promotes a draft task", async () => {
    const graph = new ESRGraph();
    makeEntity(graph, "t1", { role: "Task" });
    const store = new ESRRuntimeStateStore();
    const drivers = makeDriverRegistry(graph, store);
    const result = await drivers.run("esr_promote_task", { entity_id: "t1", new_state: "active" }, { graph, store });
    expect(result.status).toBe("succeeded");
    expect(graph.getEntity("t1")?.state).toBe("active");
  });

  it("rejects non-task promotion", async () => {
    const graph = new ESRGraph();
    makeEntity(graph, "a1");
    const store = new ESRRuntimeStateStore();
    const drivers = makeDriverRegistry(graph, store);
    const result = await drivers.run("esr_promote_task", { entity_id: "a1", new_state: "active" }, { graph, store });
    expect(result.status).toBe("failed");
  });
});

describe("esr_update_artifact driver", () => {
  it("upserts an artifact", async () => {
    const graph = new ESRGraph();
    const store = new ESRRuntimeStateStore();
    const drivers = makeDriverRegistry(graph, store);
    const result = await drivers.run("esr_update_artifact", {
      id: "a1", type: "document", version: 1,
      sections: [{ name: "intro", state: "draft" }],
    }, { graph, store });
    expect(result.status).toBe("succeeded");
    expect(graph.getArtifact("a1")?.sections).toHaveLength(1);
  });
});

describe("esr_apply_constraint driver", () => {
  it("applies a constraint", async () => {
    const graph = new ESRGraph();
    makeEntity(graph, "e1");
    const store = new ESRRuntimeStateStore();
    const drivers = makeDriverRegistry(graph, store);
    const result = await drivers.run("esr_apply_constraint", { entity_id: "e1", constraint_description: "must be valid" }, { graph, store });
    expect(result.status).toBe("succeeded");
    const rels = graph.getAllRelations();
    expect(rels.some(r => r.type === "validates" && r.to === "e1")).toBe(true);
  });
});

describe("esr_remove_entity driver", () => {
  it("removes entity and cascades relations", async () => {
    const graph = new ESRGraph();
    makeEntity(graph, "a");
    makeEntity(graph, "b");
    graph.linkRelation("a", "b", "depends_on");
    const store = new ESRRuntimeStateStore();
    const drivers = makeDriverRegistry(graph, store);
    const result = await drivers.run("esr_remove_entity", { entity_id: "a" }, { graph, store });
    expect(result.status).toBe("succeeded");
    expect(graph.getEntity("a")).toBeUndefined();
    expect(graph.getAllRelations()).toHaveLength(0);
  });
});

describe("esr_remove_relation driver", () => {
  it("removes a relation", async () => {
    const graph = new ESRGraph();
    makeEntity(graph, "a");
    makeEntity(graph, "b");
    graph.linkRelation("a", "b", "depends_on");
    const store = new ESRRuntimeStateStore();
    const drivers = makeDriverRegistry(graph, store);
    const result = await drivers.run("esr_remove_relation", { from: "a", to: "b", type: "depends_on" }, { graph, store });
    expect(result.status).toBe("succeeded");
    expect(graph.getAllRelations()).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════
// Scheduler Tests
// ═══════════════════════════════════════════════════════════

describe("Scheduler", () => {
  it("selects node with fewer dependencies first", () => {
    const ready = [
      { node_id: "n2", dependencies: ["a", "b"], state: "ready" } as any,
      { node_id: "n1", dependencies: [], state: "ready" } as any,
    ];
    const next = selectNextNode({ ready, waiting: [], blocked: [] });
    expect(next?.node_id).toBe("n1");
  });

  it("returns null for empty ready list", () => {
    expect(selectNextNode({ ready: [], waiting: [], blocked: [] })).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════
// Build Runtime Context
// ═══════════════════════════════════════════════════════════

describe("buildRuntimeContext", () => {
  it("returns empty string for no nodes", () => {
    const store = new ESRRuntimeStateStore();
    expect(buildRuntimeContext(store)).toBe("");
  });

  it("includes node state and dependencies", () => {
    const store = new ESRRuntimeStateStore();
    store.createNode({
      node_id: "n1",
      task_entity_id: "task-1",
      kind: "tool",
      state: "pending",
      inputs: { toolName: "esr_create_entity", params: { entity_id: "e1" } },
      outputs: {},
      dependencies: ["n0"],
      retry_count: 0,
      max_retries: 0,
      driver_version: "v1",
    });
    const ctx = buildRuntimeContext(store);
    expect(ctx).toContain("n1");
    expect(ctx).toContain("pending");
    expect(ctx).toContain("n0");
  });
});

// ═══════════════════════════════════════════════════════════
// DAG Execution (esr_create_node + esr_run)
// ═══════════════════════════════════════════════════════════

describe("DAG Execution", () => {
  it("executes a node through ToolDriverRegistry", async () => {
    const graph = new ESRGraph();
    const store = new ESRRuntimeStateStore();
    const drivers = new ToolDriverRegistry();

    // Register driver that creates an entity
    drivers.register("esr_create_entity", async (params) => {
      const result = graph.createEntity({
        entity_id: String(params.entity_id),
        role: "Concept",
        state: "draft",
        confidence: 0,
        metrics: {},
        updated_at: new Date().toISOString(),
      });
      if (!result.ok) return { status: "failed", error: result.error };
      return { status: "succeeded", outputs: { entity_id: params.entity_id } };
    });

    // Create a node and run it
    store.createNode({
      node_id: "n1",
      task_entity_id: "task-1",
      kind: "tool",
      state: "pending",
      inputs: { toolName: "esr_create_entity", params: { entity_id: "e1" } },
      outputs: {},
      dependencies: [],
      retry_count: 0,
      max_retries: 0,
      driver_version: "v1",
    });

    const { computeRunnableNodes } = await import("@pi-esr/core");
    const plan = computeRunnableNodes(store);
    expect(plan.ready).toHaveLength(1);

    const next = plan.ready[0];
    const result = await drivers.run(
      next.inputs.toolName as string,
      next.inputs.params as Record<string, unknown>,
      { graph, store },
    );
    expect(result.status).toBe("succeeded");
    expect(graph.getEntity("e1")?.entity_id).toBe("e1");
  });

  it("update_state driver keeps current state when not specified", async () => {
    const graph = new ESRGraph();
    const store = new ESRRuntimeStateStore();
    const drivers = new ToolDriverRegistry();

    // Create an entity first
    graph.createEntity({
      entity_id: "e1",
      role: "Concept",
      state: "active",
      confidence: 0,
      metrics: {},
      updated_at: new Date().toISOString(),
    });

    // Register update_state driver that preserves current state
    drivers.register("esr_update_state", async (params) => {
      const entityId = String(params.entity_id ?? "");
      const current = graph.getEntity(entityId);
      const targetState = (params.state as any) ?? current?.state ?? "active";
      const result = graph.updateEntityState(
        entityId,
        targetState,
        typeof params.confidence === "number" ? params.confidence : undefined,
        params.metrics && typeof params.metrics === "object" ? params.metrics as Record<string, number> : undefined,
      );
      if (!result.ok) return { status: "failed", error: result.error };
      return { status: "succeeded", outputs: { entity_id: entityId } };
    });

    // Run update_state WITHOUT specifying state — should keep "active"
    store.createNode({
      node_id: "n1",
      task_entity_id: "task-1",
      kind: "tool",
      state: "pending",
      inputs: { toolName: "esr_update_state", params: { entity_id: "e1", confidence: 0.9 } },
      outputs: {},
      dependencies: [],
      retry_count: 0,
      max_retries: 0,
      driver_version: "v1",
    });

    const result = await drivers.run(
      "esr_update_state",
      { entity_id: "e1", confidence: 0.9 },
      { graph, store },
    );
    expect(result.status).toBe("succeeded");
    expect(graph.getEntity("e1")?.state).toBe("active");
    expect(graph.getEntity("e1")?.confidence).toBe(0.9);
  });
});
