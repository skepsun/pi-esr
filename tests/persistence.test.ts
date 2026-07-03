/**
 * pi-esr: Persistence tests — graph reconstruction + validation
 */
import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ESRGraph } from "@pi-esr/core";
import { reconstructGraph } from "../extensions/persistence/reconstruct";
import { persistGraphState } from "../extensions/persistence/graph-persist";

const tmpDirs: string[] = [];
const originalMemoryDir = process.env.PI_ESR_MEMORY_DIR;

afterEach(() => {
  if (originalMemoryDir === undefined) {
    delete process.env.PI_ESR_MEMORY_DIR;
  } else {
    process.env.PI_ESR_MEMORY_DIR = originalMemoryDir;
  }
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

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

describe("Persistence mirror locking", () => {
  it("skips project file writes when the lock is already held", () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-esr-extension-lock-"));
    tmpDirs.push(dir);
    process.env.PI_ESR_MEMORY_DIR = dir;
    writeFileSync(join(dir, "esr-state.json.lock"), "other-process");

    const graph = new ESRGraph();
    graph.createEntity({
      entity_id: "task-lock",
      role: "Task",
      state: "draft",
      confidence: 0,
      metrics: {},
      updated_at: new Date().toISOString(),
    });
    const entries: unknown[] = [];

    persistGraphState({
      appendEntry(_type: string, data: unknown) {
        entries.push(data);
      },
    } as never, graph);

    expect(entries).toHaveLength(1);
    expect(existsSync(join(dir, "esr-state.json"))).toBe(false);
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
