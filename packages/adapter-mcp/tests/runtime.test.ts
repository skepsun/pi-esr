/**
 * Test the actual MCP adapter runtime driver registration.
 * These tests exercise registerRuntimeDrivers() from tools.ts directly,
 * not a hand-rolled stub.
 */
import { describe, expect, it } from "vitest";
import { ESRGraph, ESRRuntimeStateStore, ToolDriverRegistry } from "@pi-esr/core";
import { init, TOOLS } from "../src/tools";

describe("MCP Runtime Drivers", () => {
  it("esr_run dispatches nodes through registered drivers", async () => {
    const graph = new ESRGraph();
    const store = new ESRRuntimeStateStore();
    const drivers = new ToolDriverRegistry();

    // Initialize with a minimal mock repository
    const mockRepo = {
      syncFromGraph: () => {},
      loadGraph: () => graph.toPersistedState(),
      saveEntity: (input: any) => {
        // Minimal: just call graph methods directly
        const e = graph.getEntity(input.entity.entity_id);
        if (e) {
          graph.updateEntityState(
            input.entity.entity_id,
            input.entity.state ?? e.state,
            input.entity.confidence,
            input.entity.metrics,
          );
          return { ok: true, value: { ...input.entity, version: (e as any)?.version ?? 1 }, revision: 1 };
        }
        return { ok: false, error: "not found" };
      },
    } as any;

    init(graph, store, drivers, null, mockRepo);

    // Create a node and run it
    const node = store.createNode({
      node_id: "n1",
      task_entity_id: "task-1",
      kind: "tool",
      state: "pending",
      inputs: { toolName: "esr_create_entity", params: { entity_id: "e1", role: "Concept" } },
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

  it("esr_update_state driver preserves current state when not specified", async () => {
    const graph = new ESRGraph();
    const store = new ESRRuntimeStateStore();
    const drivers = new ToolDriverRegistry();

    graph.createEntity({
      entity_id: "e1",
      role: "Concept",
      state: "stable",
      confidence: 0,
      metrics: {},
      updated_at: new Date().toISOString(),
    });

    const mockRepo = {
      syncFromGraph: () => {},
      loadGraph: () => graph.toPersistedState(),
      saveEntity: () => ({ ok: true, value: { version: 2 }, revision: 1 }),
    } as any;

    init(graph, store, drivers, null, mockRepo);

    // Dispatch update_state WITHOUT a state param
    const result = await drivers.run(
      "esr_update_state",
      { entity_id: "e1", confidence: 0.95 },
      { graph, store },
    );
    expect(result.status).toBe("succeeded");
    // State should remain "stable" (not defaulted to "active")
    expect(graph.getEntity("e1")?.state).toBe("stable");
    expect(graph.getEntity("e1")?.confidence).toBe(0.95);
  });

  it("esr_update_state driver changes state when specified", async () => {
    const graph = new ESRGraph();
    const store = new ESRRuntimeStateStore();
    const drivers = new ToolDriverRegistry();

    graph.createEntity({
      entity_id: "e1",
      role: "Concept",
      state: "draft",
      confidence: 0,
      metrics: {},
      updated_at: new Date().toISOString(),
    });

    const mockRepo = {
      syncFromGraph: () => {},
      loadGraph: () => graph.toPersistedState(),
      saveEntity: () => ({ ok: true, value: { version: 2 }, revision: 1 }),
    } as any;

    init(graph, store, drivers, null, mockRepo);

    const result = await drivers.run(
      "esr_update_state",
      { entity_id: "e1", state: "active", confidence: 0.8 },
      { graph, store },
    );
    expect(result.status).toBe("succeeded");
    expect(graph.getEntity("e1")?.state).toBe("active");
    expect(graph.getEntity("e1")?.confidence).toBe(0.8);
  });
});
