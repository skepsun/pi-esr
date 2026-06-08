import { describe, expect, it } from "vitest";
import { SqliteESRRepository } from "@pi-esr/core";
import type { ESRPersistedState } from "@pi-esr/core";

function makeState(): ESRPersistedState {
  return {
    version: 1,
    entities: [
      {
        entity_id: "task-1",
        role: "Task",
        state: "draft",
        confidence: 0,
        metrics: {},
        updated_at: "2026-06-08T00:00:00.000Z",
      },
    ],
    relations: [],
    artifacts: [],
  };
}

describe("SqliteESRRepository", () => {
  it("loads seeded state", () => {
    const repo = new SqliteESRRepository(":memory:", makeState());
    const graph = repo.loadGraph();
    expect(graph.entities).toHaveLength(1);
    expect(graph.entities[0]?.entity_id).toBe("task-1");
  });

  it("updates entity version", () => {
    const repo = new SqliteESRRepository(":memory:", makeState());
    const result = repo.saveEntity({
      entity: {
        entity_id: "task-1",
        role: "Task",
        state: "active",
        confidence: 0.5,
        metrics: { done: 1 },
        updated_at: new Date().toISOString(),
      },
      expected_version: 1,
      actor_id: "test",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.version).toBe(2);
    expect(result.revision).toBe(2);
    expect(repo.getEntity("task-1")?.version).toBe(2);
  });

  it("rejects stale expected_version", () => {
    const repo = new SqliteESRRepository(":memory:", makeState());
    const ok = repo.saveEntity({
      entity: {
        entity_id: "task-1",
        role: "Task",
        state: "active",
        confidence: 0.5,
        metrics: {},
        updated_at: new Date().toISOString(),
      },
      expected_version: 1,
    });
    expect(ok.ok).toBe(true);

    const stale = repo.saveEntity({
      entity: {
        entity_id: "task-1",
        role: "Task",
        state: "stable",
        confidence: 0.8,
        metrics: {},
        updated_at: new Date().toISOString(),
      },
      expected_version: 1,
    });

    expect(stale.ok).toBe(false);
    if (stale.ok) return;
    expect(stale.error).toBe("version_conflict");
    expect(stale.conflict?.current_version).toBe(2);
  });

  it("detects concurrent writes to different entities via graph_version", () => {
    // Two entities — two clients update different ones concurrently
    const initialState: ESRPersistedState = {
      version: 1,
      entities: [
        { entity_id: "a", role: "Task" as const, state: "draft" as const, confidence: 0, metrics: {}, updated_at: new Date().toISOString() },
        { entity_id: "b", role: "Task" as const, state: "draft" as const, confidence: 0, metrics: {}, updated_at: new Date().toISOString() },
      ],
      relations: [],
      artifacts: [],
    };
    const repo = new SqliteESRRepository(":memory:", initialState);

    // Client A: update entity "a"
    const resultA = repo.saveEntity({
      entity: { entity_id: "a", role: "Task", state: "active", confidence: 0.5, metrics: {}, updated_at: new Date().toISOString() },
    });
    expect(resultA.ok).toBe(true);

    // Client B: update entity "b" — should also succeed (different entity)
    const resultB = repo.saveEntity({
      entity: { entity_id: "b", role: "Task", state: "active", confidence: 0.5, metrics: {}, updated_at: new Date().toISOString() },
    });
    expect(resultB.ok).toBe(true);

    // Both entities updated
    const final = repo.loadGraph();
    expect(final.entities.find(e => e.entity_id === "a")?.state).toBe("active");
    expect(final.entities.find(e => e.entity_id === "b")?.state).toBe("active");
  });
});
