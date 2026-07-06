import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ESRGraph, SqliteESRRepository } from "@pi-esr/core";
import { NullMemoryProvider } from "../../memory-bridge/src/index.js";
import { TOOLS, init } from "../src/tools";
import { persist } from "../src/persistence";

const tmpDirs: string[] = [];
const originalSnapshotPath = process.env.ESR_SNAPSHOT_PATH;

afterEach(() => {
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

function makeRepo(): SqliteESRRepository {
  const dir = mkdtempSync(join(tmpdir(), "pi-esr-mcp-tools-"));
  tmpDirs.push(dir);
  return new SqliteESRRepository(join(dir, "repo.db"));
}

describe("adapter-mcp pack tools", () => {
  it("lists available packs (classic three plus any external)", async () => {
    init(new ESRGraph(), new NullMemoryProvider(), makeRepo());

    const text = await TOOLS.esr_list_packs.handler({});

    expect(text).toContain("Available packs");
    expect(text).toContain("govdoc@0.6.3");
    expect(text).toContain("planning-review@0.6.3");
    expect(text).toContain("software@0.6.3");
  });

  it("detects govdoc pack for proposal prompts", async () => {
    init(new ESRGraph(), new NullMemoryProvider(), makeRepo());

    const text = await TOOLS.esr_detect_pack.handler({
      prompt: "写一个公文式项目申请书并补充预算和政策依据",
    });

    expect(text).toContain("Detected pack: govdoc");
  });

  it("expands software pack into ESR state through MCP tool", async () => {
    const graph = new ESRGraph();
    init(graph, new NullMemoryProvider(), makeRepo());

    const text = await TOOLS.esr_expand_with_pack.handler({
      goal: "refactor auth module and add tests",
      pack_name: "software",
    });

    expect(text).toContain("Expanded with pack: software");
    expect(graph.getEntity("task-main")?.role).toBe("Task");
    expect(graph.getAllEntities().filter((entity) => entity.role === "Constraint")).toHaveLength(2);
  });

  it("does not write snapshot when lock is already held", () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-esr-lock-"));
    tmpDirs.push(dir);
    process.env.ESR_SNAPSHOT_PATH = join(dir, "esr-state.json");
    writeFileSync(join(dir, "esr-state.json.lock"), "other-process");

    const result = persist({
      version: 1,
      entities: [],
      relations: [],
      artifacts: [],
      memory_refs: [],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("acquire snapshot lock");
    expect(existsSync(join(dir, "esr-state.json"))).toBe(false);
  });

  it("reports snapshot mirror failure while keeping repository as source of truth", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-esr-mirror-"));
    tmpDirs.push(dir);
    process.env.ESR_SNAPSHOT_PATH = join(dir, "esr-state.json");
    writeFileSync(join(dir, "esr-state.json.lock"), "other-process");

    const graph = new ESRGraph();
    const repo = makeRepo();
    init(graph, new NullMemoryProvider(), repo);

    const text = await TOOLS.esr_create_entity.handler({
      entity_id: "task-lock",
      role: "Task",
      state: "draft",
    });

    expect(text).toContain("ERROR: snapshot_mirror_failed");
    expect(repo.loadGraph().entities.some(entity => entity.entity_id === "task-lock")).toBe(true);
    expect(existsSync(join(dir, "esr-state.json"))).toBe(false);
  });

  it("mirrors successful mutations to snapshot exactly once through the state service", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-esr-mirror-ok-"));
    tmpDirs.push(dir);
    process.env.ESR_SNAPSHOT_PATH = join(dir, "esr-state.json");

    const graph = new ESRGraph();
    const repo = makeRepo();
    init(graph, new NullMemoryProvider(), repo);

    const text = await TOOLS.esr_create_entity.handler({
      entity_id: "task-ok",
      role: "Task",
      state: "draft",
    });

    expect(text).toContain("Created entity: task-ok");
    const snapshot = JSON.parse(readFileSync(join(dir, "esr-state.json"), "utf-8"));
    expect(snapshot.entities.some((entity: { entity_id: string }) => entity.entity_id === "task-ok")).toBe(true);
    expect(repo.loadGraph().entities.some(entity => entity.entity_id === "task-ok")).toBe(true);
  });
});
