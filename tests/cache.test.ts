import { describe, expect, it } from "vitest";
import { ESRGraph } from "../extensions/core/graph";
import { buildNodeCacheKey, InMemoryCacheStore } from "../extensions/runtime/cache";
import { ESRRuntimeStateStore } from "../extensions/runtime/state";

function createNode(nodeId: string, params: Record<string, unknown>) {
  return {
    node_id: nodeId,
    task_entity_id: "task-1",
    kind: "tool" as const,
    state: "pending" as const,
    inputs: { toolName: "esr_create_entity", params },
    outputs: {},
    dependencies: [] as string[],
    retry_count: 0,
    max_retries: 0,
    driver_version: "v1",
  };
}

describe("Runtime cache", () => {
  it("produces stable key for identical inputs", () => {
    const graph = new ESRGraph();
    const store = new ESRRuntimeStateStore();
    const node = store.createNode(createNode("n1", { entity_id: "e1", role: "Concept" }));
    expect(buildNodeCacheKey(node, graph, store)).toBe(buildNodeCacheKey(node, graph, store));
  });

  it("changes when inputs change", () => {
    const graph = new ESRGraph();
    const store = new ESRRuntimeStateStore();
    const node1 = store.createNode(createNode("n1", { entity_id: "e1", role: "Concept" }));
    const node2 = store.createNode(createNode("n2", { entity_id: "e2", role: "Concept" }));
    expect(buildNodeCacheKey(node1, graph, store)).not.toBe(buildNodeCacheKey(node2, graph, store));
  });

  it("changes when artifact version changes", () => {
    const graph = new ESRGraph();
    const store = new ESRRuntimeStateStore();
    const node = store.createNode(createNode("n1", { entity_id: "e1", role: "Concept" }));
    const key1 = buildNodeCacheKey(node, graph, store);
    graph.upsertArtifact({ id: "a1", type: "document", version: 1, sections: [] });
    const key2 = buildNodeCacheKey(node, graph, store);
    expect(key1).not.toBe(key2);
  });

  it("roundtrips persisted cache state", () => {
    const cache1 = new InMemoryCacheStore();
    cache1.set("key-1", { entity_id: "e1" });
    const state = cache1.toPersistedState();

    const cache2 = new InMemoryCacheStore();
    cache2.loadFromState(state);

    expect(cache2.get("key-1")).toEqual({ entity_id: "e1" });
  });
});
