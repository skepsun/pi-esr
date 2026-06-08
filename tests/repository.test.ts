import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SqliteESRRepository } from "@pi-esr/core";
import type { ESRPersistedState } from "@pi-esr/core";

function makeEntity(id: string, state = "draft", confidence = 0) {
  return {
    entity_id: id,
    role: "Task" as const,
    state: state as "draft",
    confidence,
    metrics: {} as Record<string, number>,
    updated_at: new Date().toISOString(),
  };
}

function makeState(entities = [makeEntity("task-1")]): ESRPersistedState {
  return { version: 1, entities, relations: [], artifacts: [] };
}

let tmpDir: string;

function tempRepo(state?: ESRPersistedState) {
  const dbPath = join(tmpDir, "test.db");
  return new SqliteESRRepository(dbPath, state);
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "esr-repo-"));
});

afterEach(() => {
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* OK */ }
});

describe("SqliteESRRepository", () => {
  it("loads seeded state", () => {
    const repo = tempRepo(makeState());
    const graph = repo.loadGraph();
    expect(graph.entities).toHaveLength(1);
    expect(graph.entities[0]?.entity_id).toBe("task-1");
  });

  it("updates entity version", () => {
    const repo = tempRepo(makeState());
    const result = repo.saveEntity({
      entity: makeEntity("task-1", "active", 0.5),
      expected_version: 1,
      actor_id: "test",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.version).toBe(2);
    expect(result.revision).toBe(2);
  });

  it("rejects stale expected_version", () => {
    const repo = tempRepo(makeState());
    const ok = repo.saveEntity({
      entity: makeEntity("task-1", "active", 0.5),
      expected_version: 1,
    });
    expect(ok.ok).toBe(true);

    const stale = repo.saveEntity({
      entity: makeEntity("task-1", "stable", 0.8),
      expected_version: 1,
    });
    expect(stale.ok).toBe(false);
    if (stale.ok) return;
    expect(stale.error).toBe("version_conflict");
  });

  it("two clients updating different entities succeed", () => {
    const initialState: ESRPersistedState = {
      version: 1,
      entities: [makeEntity("a"), makeEntity("b")],
      relations: [],
      artifacts: [],
    };
    const repo = tempRepo(initialState);

    const rA = repo.saveEntity({ entity: makeEntity("a", "active", 0.5) });
    expect(rA.ok).toBe(true);

    const rB = repo.saveEntity({ entity: makeEntity("b", "active", 0.5) });
    expect(rB.ok).toBe(true);

    const final = repo.loadGraph();
    expect(final.entities.find(e => e.entity_id === "a")?.state).toBe("active");
    expect(final.entities.find(e => e.entity_id === "b")?.state).toBe("active");
  });

  it("two clients updating same entity — second gets version_conflict with expected_version", () => {
    const dbPath = join(tmpDir, "test.db");
    const initialState: ESRPersistedState = {
      version: 1,
      entities: [makeEntity("task-1")],
      relations: [],
      artifacts: [],
    };

    // Both repos created from the same initial state
    const repo1 = new SqliteESRRepository(dbPath, initialState);
    const repo2 = new SqliteESRRepository(dbPath, initialState);

    // Both clients read version 1 and try to save with expected_version=1
    const r1 = repo1.saveEntity({
      entity: makeEntity("task-1", "active", 0.5),
      expected_version: 1,
    });
    expect(r1.ok).toBe(true);

    // Client B also sends expected_version=1 — but version is now 2
    // Because saveEntity reads latest version inside the transaction
    const r2 = repo2.saveEntity({
      entity: makeEntity("task-1", "stable", 0.8),
      expected_version: 1,
    });
    expect(r2.ok).toBe(false);
    if (r2.ok) return;
    expect(r2.error).toBe("version_conflict");
    expect(r2.conflict?.current_version).toBe(2);
  });
});
