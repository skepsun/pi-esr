import { describe, expect, it } from "vitest";
import { ESRGraph, getClosureStatus, listClosureGaps, listTasks } from "../src";

function makeEntity(id: string, overrides: Record<string, unknown> = {}) {
  return {
    entity_id: id,
    role: "Concept" as const,
    state: "draft" as const,
    confidence: 1,
    metrics: {},
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

describe("Closure Status", () => {
  it("reports missing task when entity does not exist", () => {
    const graph = new ESRGraph();
    const status = getClosureStatus(graph, "task-missing");

    expect(status.task_exists).toBe(false);
    expect(status.ready_for_stable).toBe(false);
    expect(status.missing).toEqual(["task"]);
  });

  it("reports artifact and evaluation gaps for active task", () => {
    const graph = new ESRGraph();
    graph.createEntity(makeEntity("task-1", { role: "Task", state: "active" }));

    const status = getClosureStatus(graph, "task-1");

    expect(status.task_exists).toBe(true);
    expect(status.has_artifact).toBe(false);
    expect(status.has_evaluation).toBe(false);
    expect(status.missing).toEqual(["artifact", "evaluation"]);
  });

  it("becomes ready when artifact and evaluation exist", () => {
    const graph = new ESRGraph();
    graph.createEntity(makeEntity("task-1", { role: "Task", state: "active" }));
    graph.createEntity(makeEntity("actor-1", { role: "Actor", state: "stable" }));
    graph.upsertArtifact({
      id: "src/a.ts",
      type: "code",
      sections: [{ name: "body", state: "stable" }],
    });
    graph.linkRelation("task-1", "src/a.ts", "produces");
    graph.evaluate("task-1", "actor-1", 0.95, { tests: 10 });

    const status = getClosureStatus(graph, "task-1");

    expect(status.has_artifact).toBe(true);
    expect(status.artifact_ids).toEqual(["src/a.ts"]);
    expect(status.has_evaluation).toBe(true);
    expect(status.evaluation_sources).toEqual(["actor-1"]);
    expect(status.ready_for_stable).toBe(true);
    expect(status.missing).toEqual([]);
  });

  it("requires memory ref when policy enables it", () => {
    const graph = new ESRGraph();
    graph.createEntity(makeEntity("task-1", { role: "Task", state: "active" }));
    graph.createEntity(makeEntity("actor-1", { role: "Actor", state: "stable" }));
    graph.upsertArtifact({
      id: "src/a.ts",
      type: "code",
      sections: [{ name: "body", state: "stable" }],
    });
    graph.linkRelation("task-1", "src/a.ts", "produces");
    graph.evaluate("task-1", "actor-1", 0.95, { tests: 10 });

    const status = getClosureStatus(graph, "task-1", {
      policy: { require_memory_ref_for_stable: true },
    });

    expect(status.has_memory_ref).toBe(false);
    expect(status.ready_for_stable).toBe(false);
    expect(status.missing).toContain("memory_ref");
  });

  it("tracks satisfied and unsatisfied constraints", () => {
    const graph = new ESRGraph();
    graph.createEntity(makeEntity("task-1", { role: "Task", state: "active" }));
    graph.createEntity(makeEntity("actor-1", { role: "Actor", state: "stable" }));
    graph.upsertArtifact({
      id: "src/a.ts",
      type: "code",
      sections: [{ name: "body", state: "stable" }],
    });
    graph.linkRelation("task-1", "src/a.ts", "produces");
    graph.evaluate("task-1", "actor-1", 0.95, { tests: 10 });
    graph.applyConstraint("task-1", "must pass typecheck");
    graph.applyConstraint("task-1", "must pass tests");

    const constraints = graph.getAllEntities()
      .filter((entity) => entity.role === "Constraint")
      .map((entity) => entity.entity_id)
      .sort();
    graph.updateEntityState(constraints[0], "stable");

    const status = getClosureStatus(graph, "task-1", {
      policy: { require_constraints_satisfied_for_stable: true },
    });

    expect(status.has_constraint).toBe(true);
    expect(status.satisfied_constraints).toHaveLength(1);
    expect(status.unsatisfied_constraints).toHaveLength(1);
    expect(status.ready_for_stable).toBe(false);
    expect(status.missing).toContain("constraint");
  });

  it("accepts attached memory refs", () => {
    const graph = new ESRGraph();
    graph.createEntity(makeEntity("task-1", { role: "Task", state: "active" }));
    graph.createEntity(makeEntity("actor-1", { role: "Actor", state: "stable" }));
    graph.upsertArtifact({
      id: "src/a.ts",
      type: "code",
      sections: [{ name: "body", state: "stable" }],
    });
    graph.linkRelation("task-1", "src/a.ts", "produces");
    graph.evaluate("task-1", "actor-1", 0.95, { tests: 10 });
    graph.attachMemoryRef("task-1", {
      ref_id: "42",
      provider: "sqlite-memory",
      entity_id: "task-1",
      kind: "summary",
      created_at: new Date().toISOString(),
    });

    const status = getClosureStatus(graph, "task-1", {
      policy: { require_memory_ref_for_stable: true },
    });

    expect(status.has_memory_ref).toBe(true);
    expect(status.memory_ref_ids).toEqual(["42"]);
    expect(status.ready_for_stable).toBe(true);
  });

  it("lists only tasks with closure gaps by default", () => {
    const graph = new ESRGraph();
    graph.createEntity(makeEntity("task-ready", { role: "Task", state: "active", label: "Ready Task" }));
    graph.createEntity(makeEntity("task-gap", { role: "Task", state: "active", label: "Gap Task" }));
    graph.createEntity(makeEntity("actor-1", { role: "Actor", state: "stable" }));
    graph.upsertArtifact({
      id: "src/ready.ts",
      type: "code",
      sections: [{ name: "body", state: "stable" }],
    });
    graph.linkRelation("task-ready", "src/ready.ts", "produces");
    graph.evaluate("task-ready", "actor-1", 0.95, { tests: 10 });

    const items = listClosureGaps(graph);

    expect(items).toHaveLength(1);
    expect(items[0]?.task_id).toBe("task-gap");
    expect(items[0]?.label).toBe("Gap Task");
    expect(items[0]?.missing).toEqual(["artifact", "evaluation"]);
  });

  it("can include ready tasks in closure gap listing", () => {
    const graph = new ESRGraph();
    graph.createEntity(makeEntity("task-ready", { role: "Task", state: "active" }));
    graph.createEntity(makeEntity("task-gap", { role: "Task", state: "active" }));
    graph.createEntity(makeEntity("actor-1", { role: "Actor", state: "stable" }));
    graph.upsertArtifact({
      id: "src/ready.ts",
      type: "code",
      sections: [{ name: "body", state: "stable" }],
    });
    graph.linkRelation("task-ready", "src/ready.ts", "produces");
    graph.evaluate("task-ready", "actor-1", 0.95, { tests: 10 });

    const items = listClosureGaps(graph, { includeReady: true });

    expect(items).toHaveLength(2);
    expect(items.map((item) => item.task_id)).toEqual(["task-gap", "task-ready"]);
    expect(items[1]?.ready_for_stable).toBe(true);
  });

  it("lists tasks with closure summary and filters by state", () => {
    const graph = new ESRGraph();
    graph.createEntity(makeEntity("task-active", { role: "Task", state: "active", label: "Active Task", confidence: 0.7 }));
    graph.createEntity(makeEntity("task-draft", { role: "Task", state: "draft", label: "Draft Task", confidence: 0.2 }));
    graph.createEntity(makeEntity("actor-1", { role: "Actor", state: "stable" }));
    graph.upsertArtifact({
      id: "src/active.ts",
      type: "code",
      sections: [{ name: "body", state: "stable" }],
    });
    graph.linkRelation("task-active", "src/active.ts", "produces");
    graph.evaluate("task-active", "actor-1", 0.95, { tests: 10 });

    const allTasks = listTasks(graph);
    const activeTasks = listTasks(graph, { state: "active" });

    expect(allTasks).toHaveLength(2);
    expect(allTasks[0]?.task_id).toBe("task-active");
    expect(allTasks[0]?.ready_for_stable).toBe(true);
    expect(allTasks[1]?.task_id).toBe("task-draft");
    expect(activeTasks).toHaveLength(1);
    expect(activeTasks[0]?.task_id).toBe("task-active");
  });

  it("can hide ready tasks from task list", () => {
    const graph = new ESRGraph();
    graph.createEntity(makeEntity("task-ready", { role: "Task", state: "active" }));
    graph.createEntity(makeEntity("task-gap", { role: "Task", state: "active" }));
    graph.createEntity(makeEntity("actor-1", { role: "Actor", state: "stable" }));
    graph.upsertArtifact({
      id: "src/ready.ts",
      type: "code",
      sections: [{ name: "body", state: "stable" }],
    });
    graph.linkRelation("task-ready", "src/ready.ts", "produces");
    graph.evaluate("task-ready", "actor-1", 0.95, { tests: 10 });

    const items = listTasks(graph, { includeReady: false });

    expect(items).toHaveLength(1);
    expect(items[0]?.task_id).toBe("task-gap");
  });
});
