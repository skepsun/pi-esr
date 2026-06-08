/**
 * pi-esr: Persistence tests — reconstruct + validation
 */
import { describe, expect, it } from "vitest";
import { ESRGraph } from "@pi-esr/core";
import { ESRRuntimeStateStore } from "@pi-esr/core";
import { InMemoryCacheStore as CacheStore } from "@pi-esr/core";
import { reconstructGraph } from "../extensions/persistence/reconstruct";
import { reconstructRuntimeState } from "../extensions/persistence/runtime-state";
import { reconstructRuntimeCache } from "../extensions/persistence/runtime-cache";

function createNode(nodeId: string, toolName: string, params: Record<string, unknown>) {
  return {
    node_id: nodeId,
    task_entity_id: "task-1",
    kind: "tool" as const,
    state: "pending" as const,
    inputs: { toolName, params },
    outputs: {} as Record<string, unknown>,
    dependencies: [] as string[],
    retry_count: 0,
    max_retries: 0,
    driver_version: "v1",
  };
}

describe("Persistence reconstruction", () => {
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
});

describe("Reconstruct validation", () => {
  it("reconstructGraph rejects malformed data", async () => {
    const graph = new ESRGraph();
    await reconstructGraph({
      sessionManager: {
        getBranch() {
          return [
            { type: "custom", customType: "esr-state", data: { not: "valid" } },
          ];
        },
        getSessionDir() { return null; },
      },
    } as never, graph);
    // Malformed data is rejected — graph stays empty (reconstruct clears before loading)
    expect(graph.getAllEntities()).toHaveLength(0);
  });

  it("reconstructRuntimeState rejects malformed data", () => {
    const store = new ESRRuntimeStateStore();
    reconstructRuntimeState({
      sessionManager: {
        getBranch() {
          return [
            { type: "custom", customType: "esr-runtime-state", data: { bad: true } },
          ];
        },
      },
    } as never, store);
    // Malformed data rejected — store is empty
    expect(store.getNodes()).toHaveLength(0);
  });

  it("reconstructRuntimeCache rejects malformed data", () => {
    const cache = new CacheStore();
    reconstructRuntimeCache({
      sessionManager: {
        getBranch() {
          return [
            { type: "custom", customType: "esr-runtime-cache", data: { entries: "not-an-array" } },
          ];
        },
      },
    } as never, cache);
    // Malformed data rejected — cache is empty
    expect(cache.get("key1")).toBeNull();
  });
});
