import { describe, expect, it } from "vitest";
import { computeRunnableNodes } from "../src";
import { ESRRuntimeStateStore } from "../src";

function createNode(nodeId: string, state: "pending" | "succeeded" | "failed" | "blocked" = "pending", dependencies: string[] = []) {
  return {
    node_id: nodeId,
    task_entity_id: "task-1",
    kind: "tool" as const,
    state,
    inputs: { toolName: "esr_create_entity", params: { entity_id: nodeId, role: "Concept" } },
    outputs: {},
    dependencies,
    retry_count: 0,
    max_retries: 0,
    driver_version: "v1",
  };
}

describe("Planner", () => {
  it("marks dependency-free pending node as ready", () => {
    const store = new ESRRuntimeStateStore();
    store.createNode(createNode("n1"));
    const plan = computeRunnableNodes(store);
    expect(plan.ready.map(node => node.node_id)).toEqual(["n1"]);
  });

  it("marks node ready when dependencies succeeded", () => {
    const store = new ESRRuntimeStateStore();
    store.createNode(createNode("n1", "succeeded"));
    store.createNode(createNode("n2", "pending", ["n1"]));
    const plan = computeRunnableNodes(store);
    expect(plan.ready.map(node => node.node_id)).toEqual(["n2"]);
  });

  it("marks node blocked when dependency failed", () => {
    const store = new ESRRuntimeStateStore();
    store.createNode(createNode("n1", "failed"));
    store.createNode(createNode("n2", "pending", ["n1"]));
    const plan = computeRunnableNodes(store);
    expect(plan.blocked.map(node => node.node_id)).toEqual(["n2"]);
  });

  it("keeps node waiting when dependencies incomplete", () => {
    const store = new ESRRuntimeStateStore();
    store.createNode(createNode("n1", "pending"));
    store.createNode(createNode("n2", "pending", ["n1"]));
    const plan = computeRunnableNodes(store);
    expect(plan.waiting.map(node => node.node_id)).toEqual(["n2"]);
  });
});
