/**
 * pi-esr: Persistence tests — graph reconstruction + validation
 */
import { describe, expect, it } from "vitest";
import { ESRGraph } from "@pi-esr/core";
import { reconstructGraph } from "../extensions/persistence/reconstruct";

function makePersistedState() {
  return {
    version: 3,
    entities: [
      {
        entity_id: "task-1",
        role: "Task" as const,
        state: "active" as const,
        confidence: 0.9,
        metrics: { score: 1 },
        updated_at: new Date().toISOString(),
        label: "Task 1",
      },
    ],
    relations: [
      {
        from: "task-1",
        to: "task-1",
        type: "refines" as const,
      },
    ],
    artifacts: [],
  };
}

describe("Persistence reconstruction", () => {
  it("reconstructs graph state from session branch entries", async () => {
    const graph = new ESRGraph();
    const persisted = makePersistedState();

    await reconstructGraph({
      sessionManager: {
        getBranch() {
          return [
            {
              type: "custom",
              customType: "esr-state",
              data: persisted,
            },
          ];
        },
        getSessionDir() {
          return null;
        },
      },
    } as never, graph);

    expect(graph.getEntity("task-1")?.state).toBe("active");
    expect(graph.getEntity("task-1")?.label).toBe("Task 1");
    expect(graph.getAllRelations()).toHaveLength(1);
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
        getSessionDir() {
          return null;
        },
      },
    } as never, graph);

    expect(graph.getAllEntities()).toHaveLength(0);
    expect(graph.getAllRelations()).toHaveLength(0);
  });

  it("ignores unrelated custom entries", async () => {
    const graph = new ESRGraph();

    await reconstructGraph({
      sessionManager: {
        getBranch() {
          return [
            { type: "custom", customType: "other-entry", data: makePersistedState() },
          ];
        },
        getSessionDir() {
          return null;
        },
      },
    } as never, graph);

    expect(graph.getAllEntities()).toHaveLength(0);
  });
});
