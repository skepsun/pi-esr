import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryStore } from "../../core/src/store.js";
import { buildHookContext, buildInitialHookContext, buildMemoryContext, load } from "../src/hook-context";

const tmpDirs: string[] = [];
const originalCwd = process.cwd();
const originalSnapshotPath = process.env.ESR_SNAPSHOT_PATH;

afterEach(() => {
  process.chdir(originalCwd);
  delete process.env.PI_ESR_MEMORY_DIR;
  if (originalSnapshotPath === undefined) {
    delete process.env.ESR_SNAPSHOT_PATH;
  } else {
    process.env.ESR_SNAPSHOT_PATH = originalSnapshotPath;
  }
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

function makeTmpDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "pi-esr-hook-"));
  tmpDirs.push(dir);
  return dir;
}

function makeState() {
  return {
    version: 7,
    entities: [
      { entity_id: "task-b", role: "Task", state: "active", confidence: 0.8, metrics: {}, label: "Task B" },
      { entity_id: "task-a", role: "Task", state: "stable", confidence: 1, metrics: {}, label: "Task A" },
    ],
    relations: [],
    artifacts: [],
  };
}

describe("hook context", () => {
  it("injects ESR operating protocol even without persisted state", () => {
    const context = buildInitialHookContext();

    expect(context).toContain("ESR Operating Protocol for Codex");
    expect(context).toContain("No persisted ESR state was found");
    expect(context).toContain("This is not a reason to skip ESR");
    expect(context).toContain("mcp__pi-esr__esr_*");
    expect(context).toContain("Call esr_get_context before substantial work");
    expect(context).toContain("create a Task entity with esr_create_entity");
  });

  it("honors explicit ESR_SNAPSHOT_PATH without falling back to cwd state", () => {
    const dir = makeTmpDir();
    mkdirSync(join(dir, ".pi-esr-memory"), { recursive: true });
    writeFileSync(join(dir, ".pi-esr-memory", "esr-state.json"), JSON.stringify(makeState()));
    process.chdir(dir);
    process.env.ESR_SNAPSHOT_PATH = join(dir, "missing-state.json");

    expect(load()).toBeNull();
  });

  it("injects memory summary for known entities", () => {
    const memoryDir = makeTmpDir();
    process.env.PI_ESR_MEMORY_DIR = memoryDir;
    mkdirSync(memoryDir, { recursive: true });

    const store = new MemoryStore(join(memoryDir, "memory.db"));
    store.journal("task-a", "draft -> active");
    store.store("task-a", "Implemented the stable workflow for task A");
    store.store("task-b", "Investigating remaining edge cases for task B");
    store.close();

    const context = buildHookContext(makeState());
    expect(context).toContain("When to call ESR:");
    expect(context).toContain("esr_complete_task");
    expect(context).toContain("[ESR_CONTEXT]");
    expect(context).toContain("[ESR_MEMORY]");
    expect(context).toContain("task-a (1 obs):");
    expect(context).toContain("draft -> active");
    expect(context).toContain("Implemented the stable workflow for task A");
    expect(context).toContain("Investigating remaining edge cases for task B");
  });

  it("returns deterministic memory ordering by entity_id", () => {
    const memoryDir = makeTmpDir();
    process.env.PI_ESR_MEMORY_DIR = memoryDir;
    mkdirSync(memoryDir, { recursive: true });

    const store = new MemoryStore(join(memoryDir, "memory.db"));
    store.store("task-b", "Second alphabetically");
    store.store("task-a", "First alphabetically");
    store.close();

    const memory = buildMemoryContext(["task-b", "task-a"]);
    expect(memory.indexOf("task-a")).toBeLessThan(memory.indexOf("task-b"));
  });

  it("falls back to no memories when memory db is absent", () => {
    const memoryDir = makeTmpDir();
    process.env.PI_ESR_MEMORY_DIR = memoryDir;
    writeFileSync(join(memoryDir, "placeholder.txt"), "noop");

    const memory = buildMemoryContext(["task-a"]);
    expect(memory).toContain("(no memories)");
  });
});
