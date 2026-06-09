import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ESRGraph, SqliteESRRepository } from "@pi-esr/core";
import { NullMemoryProvider } from "../../memory-bridge/src/index.js";
import { TOOLS, init } from "../src/tools";

const tmpDirs: string[] = [];

afterEach(() => {
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
  it("lists built-in packs", async () => {
    init(new ESRGraph(), new NullMemoryProvider(), makeRepo());

    const text = await TOOLS.esr_list_packs.handler({});

    expect(text).toContain("Available packs (3)");
    expect(text).toContain("govdoc@0.1.0");
    expect(text).toContain("planning-review@0.1.0");
    expect(text).toContain("software@0.1.0");
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
});
