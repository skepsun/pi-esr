import { describe, expect, it } from "vitest";
import { ESRGraph } from "@pi-esr/core";
import { buildNodeCacheKey, InMemoryCacheStore } from "@pi-esr/core";
import { reconstructRuntimeState } from "../extensions/persistence/runtime-state";
import { ToolDriverRegistry } from "@pi-esr/core";
import { ESRRuntime } from "@pi-esr/core";
import { ESRRuntimeStateStore } from "@pi-esr/core";

function createNode(nodeId: string, toolName: string, params: Record<string, unknown>) {
  return {
    node_id: nodeId,
    task_entity_id: "task-1",
    kind: "tool" as const,
    state: "pending" as const,
    inputs: { toolName, params },
    outputs: {},
    dependencies: [] as string[],
    retry_count: 0,
    max_retries: 0,
    driver_version: "v1",
  };
}

describe("Runtime", () => {
  it("executes one ready node via tick", async () => {
    const graph = new ESRGraph();
    const store = new ESRRuntimeStateStore();
    const drivers = new ToolDriverRegistry();
    drivers.register("esr_create_entity", async (params, ctx) => {
      const result = ctx.graph.createEntity({
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
    const runtime = new ESRRuntime(graph, store, drivers);
    store.createNode(createNode("n1", "esr_create_entity", { entity_id: "e1" }));

    const result = await runtime.tick();
    expect(result.status).toBe("executed");
    expect(graph.getEntity("e1")?.entity_id).toBe("e1");
    expect(store.getNode("n1")?.state).toBe("succeeded");
  });

  it("returns idle when no runnable nodes exist", async () => {
    const runtime = new ESRRuntime(new ESRGraph(), new ESRRuntimeStateStore(), new ToolDriverRegistry());
    expect((await runtime.tick()).status).toBe("idle");
  });

  it("marks node failed when no handler exists", async () => {
    const graph = new ESRGraph();
    const store = new ESRRuntimeStateStore();
    const runtime = new ESRRuntime(graph, store, new ToolDriverRegistry());
    store.createNode(createNode("n1", "missing_tool", { entity_id: "e1" }));
    const result = await runtime.tick();
    expect(result.status).toBe("failed");
    expect(store.getNode("n1")?.state).toBe("failed");
  });

  it("roundtrips runtime persisted state", () => {
    const store1 = new ESRRuntimeStateStore();
    store1.createNode(createNode("n1", "esr_create_entity", { entity_id: "e1" }));
    store1.setNodeState("n1", "succeeded", { outputs: { entity_id: "e1" } });
    const state = store1.toPersistedState();

    const store2 = new ESRRuntimeStateStore();
    store2.loadFromState(state);

    expect(store2.getNode("n1")?.state).toBe("succeeded");
    expect(store2.getNode("n1")?.outputs.entity_id).toBe("e1");
    expect(store2.getEvents().length).toBe(store1.getEvents().length);
  });

  it("reconstructs runtime state from session branch entries", () => {
    const store = new ESRRuntimeStateStore();
    const persisted = {
      executionNodes: [
        {
          ...createNode("n1", "esr_create_entity", { entity_id: "e1" }),
          state: "cached" as const,
          outputs: { entity_id: "e1" },
          updated_at: new Date().toISOString(),
        },
      ],
      events: [
        { type: "node_created" as const, node_id: "n1", at: new Date().toISOString() },
      ],
      version: 2,
    };

    reconstructRuntimeState({
      sessionManager: {
        getBranch() {
          return [
            {
              type: "custom",
              customType: "esr-runtime-state",
              data: persisted,
            },
          ];
        },
      },
    } as never, store);

    expect(store.getNode("n1")?.state).toBe("cached");
    expect(store.getEvents()).toHaveLength(1);
  });

  it("hits restored cache without executing driver", async () => {
    const graph = new ESRGraph();
    const store = new ESRRuntimeStateStore();
    const cacheStore = new InMemoryCacheStore();
    const drivers = new ToolDriverRegistry();
    let executed = false;
    drivers.register("esr_create_entity", async () => {
      executed = true;
      return { status: "succeeded", outputs: { entity_id: "e1" } };
    });

    const node = store.createNode(createNode("n1", "esr_create_entity", { entity_id: "e1" }));
    const cacheKey = buildNodeCacheKey(node, graph, store);
    cacheStore.set(cacheKey, { entity_id: "e1" });

    const runtime = new ESRRuntime(graph, store, drivers, cacheStore);
    const result = await runtime.tick();

    expect(result.status).toBe("cached");
    expect(executed).toBe(false);
    expect(store.getNode("n1")?.state).toBe("cached");
  });

  it("invalidates dependent completed nodes explicitly", () => {
    const store = new ESRRuntimeStateStore();
    store.createNode(createNode("n1", "esr_create_entity", { entity_id: "e1" }));
    store.createNode({
      ...createNode("n2", "esr_update_state", { entity_id: "e1", state: "active" }),
      dependencies: ["n1"],
      state: "succeeded",
      outputs: { entity_id: "e1", state: "active" },
    });

    const invalidated = store.invalidateDependentNodes("Graph changed after entity update");

    expect(invalidated.map(node => node.node_id)).toEqual(["n2"]);
    expect(store.getNode("n2")?.state).toBe("pending");
    expect(store.getNode("n2")?.outputs).toEqual({});
    expect(store.getEvents().some(event => event.type === "node_invalidated")).toBe(true);
  });
});
