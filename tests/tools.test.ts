import { describe, expect, it } from "vitest";
import { ESRGraph } from "@pi-esr/core";
import { registerTools } from "../extensions/integration/tools";
import { softwarePack } from "@pi-esr/domain-pack-software";
import { govdocPack } from "@pi-esr/domain-pack-govdoc";
import { planningReviewPack } from "@pi-esr/domain-pack-planning-review";
import { agentToolPack } from "@pi-esr/domain-pack-agent-tool";

const packs = [softwarePack, govdocPack, planningReviewPack, agentToolPack];

type RegisteredTool = {
  name: string;
  execute: (_id: string, params: any) => Promise<any>;
  renderResult?: (result: any, options: any, theme: any) => unknown;
};

function createPiStub() {
  const tools = new Map<string, RegisteredTool>();
  const entries: Array<{ type: string; data: unknown }> = [];

  const pi = {
    registerTool(tool: RegisteredTool) {
      tools.set(tool.name, tool);
    },
    appendEntry(type: string, data: unknown) {
      entries.push({ type, data });
    },
  };

  return { pi, tools, entries };
}

async function runTool(
  tools: Map<string, RegisteredTool>,
  name: string,
  params: Record<string, unknown>,
) {
  const tool = tools.get(name);
  if (!tool) {
    throw new Error(`Tool not registered: ${name}`);
  }
  return tool.execute("test-call", params);
}

describe("registerTools", () => {
  it("registers graph manipulation tools", async () => {
    const graph = new ESRGraph();
    const { pi, tools } = createPiStub();

    await registerTools(pi as never, graph, packs);

    expect(tools.has("esr_create_entity")).toBe(true);
    expect(tools.has("esr_update_state")).toBe(true);
    expect(tools.has("esr_get_context")).toBe(true);
    expect(tools.has("esr_list_packs")).toBe(true);
    expect(tools.has("esr_detect_pack")).toBe(true);
    expect(tools.has("esr_expand_with_pack")).toBe(true);
    expect(tools.has("esr_get_closure_status")).toBe(true);
    expect(tools.has("esr_attach_memory_ref")).toBe(true);
    expect(tools.has("esr_list_closure_gaps")).toBe(true);
    expect(tools.has("esr_list_tasks")).toBe(true);
    expect(tools.has("esr_remove_entity")).toBe(true);
  });

  it("creates and updates an entity through registered tools", async () => {
    const graph = new ESRGraph();
    const { pi, tools, entries } = createPiStub();

    await registerTools(pi as never, graph, packs);

    const created = await runTool(tools, "esr_create_entity", {
      entity_id: "task-1",
      role: "Task",
      state: "draft",
      confidence: 0.4,
      metrics: { progress: 1 },
      label: "Task 1",
    });

    expect(created.content[0]?.text).toContain("Created entity");
    expect(graph.getEntity("task-1")?.role).toBe("Task");
    expect(entries).toHaveLength(1);

    const updated = await runTool(tools, "esr_update_state", {
      entity_id: "task-1",
      state: "active",
      confidence: 0.8,
    });

    expect(updated.content[0]?.text).toContain("Updated entity");
    expect(graph.getEntity("task-1")?.state).toBe("active");
    expect(graph.getEntity("task-1")?.confidence).toBe(0.8);
    expect(entries).toHaveLength(2);
  });

  it("links and removes relations through registered tools", async () => {
    const graph = new ESRGraph();
    const { pi, tools } = createPiStub();

    await registerTools(pi as never, graph, packs);

    await runTool(tools, "esr_create_entity", { entity_id: "a", role: "Concept" });
    await runTool(tools, "esr_create_entity", { entity_id: "b", role: "Concept" });

    const linked = await runTool(tools, "esr_link_relation", {
      from: "a",
      to: "b",
      type: "depends_on",
    });

    expect(linked.content[0]?.text).toContain("Linked");
    expect(graph.getAllRelations()).toHaveLength(1);

    const removed = await runTool(tools, "esr_remove_relation", {
      from: "a",
      to: "b",
      type: "depends_on",
    });

    expect(removed.content[0]?.text).toContain("Removed relation");
    expect(graph.getAllRelations()).toHaveLength(0);
  });

  it("returns current graph context", async () => {
    const graph = new ESRGraph();
    const { pi, tools } = createPiStub();

    await registerTools(pi as never, graph, packs);

    await runTool(tools, "esr_create_entity", {
      entity_id: "artifact-1",
      role: "Artifact",
      label: "Artifact 1",
    });

    const context = await runTool(tools, "esr_get_context", {});
    const text = context.content[0]?.text ?? "";

    expect(text).toContain("artifact-1");
    expect(context.details.entities).toHaveLength(1);
  });

  it("removes entity and cascades relation cleanup", async () => {
    const graph = new ESRGraph();
    const { pi, tools } = createPiStub();

    await registerTools(pi as never, graph, packs);

    await runTool(tools, "esr_create_entity", { entity_id: "a", role: "Concept" });
    await runTool(tools, "esr_create_entity", { entity_id: "b", role: "Concept" });
    await runTool(tools, "esr_link_relation", {
      from: "a",
      to: "b",
      type: "depends_on",
    });

    const removed = await runTool(tools, "esr_remove_entity", { entity_id: "a" });

    expect(removed.content[0]?.text).toContain("Removed entity");
    expect(graph.getEntity("a")).toBeUndefined();
    expect(graph.getAllRelations()).toHaveLength(0);
  });

  it("returns error text for invalid operations", async () => {
    const graph = new ESRGraph();
    const { pi, tools } = createPiStub();

    await registerTools(pi as never, graph, packs);

    const result = await runTool(tools, "esr_update_state", {
      entity_id: "missing",
      state: "active",
    });

    expect(result.content[0]?.text).toContain("ERROR:");
    expect(result.details.error).toContain("Entity not found");
  });

  it("reports error when closure task does not exist", async () => {
    const graph = new ESRGraph();
    const { pi, tools } = createPiStub();

    await registerTools(pi as never, graph, packs);

    const result = await runTool(tools, "esr_get_closure_status", {
      task_id: "missing-task",
    });

    expect(result.content[0]?.text).toContain("ERROR:");
    expect(result.details.error).toContain("Task not found");
  });

  it("reports artifact and evaluation gaps in closure status", async () => {
    const graph = new ESRGraph();
    const { pi, tools } = createPiStub();

    await registerTools(pi as never, graph, packs);
    await runTool(tools, "esr_create_entity", {
      entity_id: "task-closure-1",
      role: "Task",
      state: "active",
    });

    const result = await runTool(tools, "esr_get_closure_status", {
      task_id: "task-closure-1",
    });

    expect(result.content[0]?.text).toContain("Closure blocked");
    expect(result.details.closure.missing).toEqual(["artifact", "evaluation"]);
  });

  it("reports ready when closure evidence is complete", async () => {
    const graph = new ESRGraph();
    const { pi, tools } = createPiStub();

    await registerTools(pi as never, graph, packs);
    await runTool(tools, "esr_create_entity", {
      entity_id: "task-closure-2",
      role: "Task",
      state: "active",
    });
    await runTool(tools, "esr_create_entity", {
      entity_id: "actor-closure-2",
      role: "Actor",
      state: "stable",
    });
    await runTool(tools, "esr_update_artifact", {
      id: "artifact-closure-2",
      type: "code",
      sections: [{ name: "main", state: "stable" }],
    });
    await runTool(tools, "esr_link_relation", {
      from: "task-closure-2",
      to: "artifact-closure-2",
      type: "produces",
    });
    await runTool(tools, "esr_evaluate", {
      entity_id: "task-closure-2",
      evaluator: "actor-closure-2",
      confidence: 0.95,
      metrics: { tests: 10 },
    });

    const result = await runTool(tools, "esr_get_closure_status", {
      task_id: "task-closure-2",
    });

    expect(result.content[0]?.text).toContain("Closure ready");
    expect(result.details.closure.ready_for_stable).toBe(true);
    expect(result.details.closure.missing).toEqual([]);
  });

  it("requires memory ref when closure policy enables it", async () => {
    const graph = new ESRGraph();
    const { pi, tools } = createPiStub();

    await registerTools(pi as never, graph, packs);
    await runTool(tools, "esr_create_entity", {
      entity_id: "task-closure-3",
      role: "Task",
      state: "active",
    });
    await runTool(tools, "esr_create_entity", {
      entity_id: "actor-closure-3",
      role: "Actor",
      state: "stable",
    });
    await runTool(tools, "esr_update_artifact", {
      id: "artifact-closure-3",
      type: "code",
      sections: [{ name: "main", state: "stable" }],
    });
    await runTool(tools, "esr_link_relation", {
      from: "task-closure-3",
      to: "artifact-closure-3",
      type: "produces",
    });
    await runTool(tools, "esr_evaluate", {
      entity_id: "task-closure-3",
      evaluator: "actor-closure-3",
      confidence: 0.9,
    });

    const result = await runTool(tools, "esr_get_closure_status", {
      task_id: "task-closure-3",
      require_memory_ref_for_stable: true,
    });

    expect(result.content[0]?.text).toContain("Closure blocked");
    expect(result.details.closure.missing).toContain("memory_ref");
    expect(result.details.closure.ready_for_stable).toBe(false);
  });

  it("attaches external memory ref and satisfies closure memory requirement", async () => {
    const graph = new ESRGraph();
    const { pi, tools } = createPiStub();

    await registerTools(pi as never, graph, packs);
    await runTool(tools, "esr_create_entity", {
      entity_id: "task-memory-ref",
      role: "Task",
      state: "active",
    });
    await runTool(tools, "esr_create_entity", {
      entity_id: "actor-memory-ref",
      role: "Actor",
      state: "stable",
    });
    await runTool(tools, "esr_update_artifact", {
      id: "artifact-memory-ref",
      type: "code",
      sections: [{ name: "main", state: "stable" }],
    });
    await runTool(tools, "esr_link_relation", {
      from: "task-memory-ref",
      to: "artifact-memory-ref",
      type: "produces",
    });
    await runTool(tools, "esr_evaluate", {
      entity_id: "task-memory-ref",
      evaluator: "actor-memory-ref",
      confidence: 0.93,
    });

    const attached = await runTool(tools, "esr_attach_memory_ref", {
      entity_id: "task-memory-ref",
      ref_id: "ext-42",
      provider: "claude-mem",
      kind: "summary",
      title: "Closure summary",
    });

    expect(attached.content[0]?.text).toContain("Attached memory ref");
    expect(graph.getMemoryRefs("task-memory-ref")).toHaveLength(1);

    const closure = await runTool(tools, "esr_get_closure_status", {
      task_id: "task-memory-ref",
      require_memory_ref_for_stable: true,
    });

    expect(closure.details.closure.has_memory_ref).toBe(true);
    expect(closure.details.closure.memory_ref_ids).toEqual(["ext-42"]);
    expect(closure.details.closure.ready_for_stable).toBe(true);
  });

  it("lists tasks with closure gaps", async () => {
    const graph = new ESRGraph();
    const { pi, tools } = createPiStub();

    await registerTools(pi as never, graph, packs);
    await runTool(tools, "esr_create_entity", {
      entity_id: "task-gap-list",
      role: "Task",
      state: "active",
      label: "Gap Task",
    });
    await runTool(tools, "esr_create_entity", {
      entity_id: "task-ready-list",
      role: "Task",
      state: "active",
      label: "Ready Task",
    });
    await runTool(tools, "esr_create_entity", {
      entity_id: "actor-ready-list",
      role: "Actor",
      state: "stable",
    });
    await runTool(tools, "esr_update_artifact", {
      id: "artifact-ready-list",
      type: "code",
      sections: [{ name: "main", state: "stable" }],
    });
    await runTool(tools, "esr_link_relation", {
      from: "task-ready-list",
      to: "artifact-ready-list",
      type: "produces",
    });
    await runTool(tools, "esr_evaluate", {
      entity_id: "task-ready-list",
      evaluator: "actor-ready-list",
      confidence: 0.92,
      metrics: { tests: 8 },
    });

    const result = await runTool(tools, "esr_list_closure_gaps", {});

    expect(result.content[0]?.text).toContain("Closure gaps (1)");
    expect(result.content[0]?.text).toContain("task-gap-list");
    expect(result.content[0]?.text).not.toContain("task-ready-list");
    expect(result.details.items).toHaveLength(1);
  });

  it("can include ready tasks when listing closure gaps", async () => {
    const graph = new ESRGraph();
    const { pi, tools } = createPiStub();

    await registerTools(pi as never, graph, packs);
    await runTool(tools, "esr_create_entity", {
      entity_id: "task-gap-list-2",
      role: "Task",
      state: "active",
    });
    await runTool(tools, "esr_create_entity", {
      entity_id: "task-ready-list-2",
      role: "Task",
      state: "active",
    });
    await runTool(tools, "esr_create_entity", {
      entity_id: "actor-ready-list-2",
      role: "Actor",
      state: "stable",
    });
    await runTool(tools, "esr_update_artifact", {
      id: "artifact-ready-list-2",
      type: "code",
      sections: [{ name: "main", state: "stable" }],
    });
    await runTool(tools, "esr_link_relation", {
      from: "task-ready-list-2",
      to: "artifact-ready-list-2",
      type: "produces",
    });
    await runTool(tools, "esr_evaluate", {
      entity_id: "task-ready-list-2",
      evaluator: "actor-ready-list-2",
      confidence: 0.92,
    });

    const result = await runTool(tools, "esr_list_closure_gaps", {
      include_ready: true,
    });

    expect(result.content[0]?.text).toContain("Closure gaps (2)");
    expect(result.content[0]?.text).toContain("task-gap-list-2");
    expect(result.content[0]?.text).toContain("task-ready-list-2");
    expect(result.details.items).toHaveLength(2);
  });

  it("lists tasks with closure and memory-ref summary", async () => {
    const graph = new ESRGraph();
    const { pi, tools } = createPiStub();

    await registerTools(pi as never, graph, packs);
    await runTool(tools, "esr_create_entity", {
      entity_id: "task-list-view",
      role: "Task",
      state: "active",
      label: "Task View",
      confidence: 0.6,
    });
    await runTool(tools, "esr_create_entity", {
      entity_id: "actor-list-view",
      role: "Actor",
      state: "stable",
    });
    await runTool(tools, "esr_update_artifact", {
      id: "artifact-list-view",
      type: "code",
      sections: [{ name: "main", state: "stable" }],
    });
    await runTool(tools, "esr_link_relation", {
      from: "task-list-view",
      to: "artifact-list-view",
      type: "produces",
    });
    await runTool(tools, "esr_evaluate", {
      entity_id: "task-list-view",
      evaluator: "actor-list-view",
      confidence: 0.91,
    });
    await runTool(tools, "esr_attach_memory_ref", {
      entity_id: "task-list-view",
      ref_id: "mem-list-view",
      provider: "claude-mem",
      kind: "summary",
    });

    const result = await runTool(tools, "esr_list_tasks", {
      state: "active",
      require_memory_ref_for_stable: true,
    });

    expect(result.content[0]?.text).toContain("Tasks (1)");
    expect(result.content[0]?.text).toContain("task-list-view");
    expect(result.content[0]?.text).toContain("closure=ready");
    expect(result.content[0]?.text).toContain("memory_refs=1");
    expect(result.details.items).toHaveLength(1);
    expect(result.details.items[0]?.ready_for_stable).toBe(true);
  });

  it("detects the software domain pack for coding goals", async () => {
    const graph = new ESRGraph();
    const { pi, tools } = createPiStub();

    await registerTools(pi as never, graph, packs);

    const result = await runTool(tools, "esr_detect_pack", {
      prompt: "refactor the TypeScript API module and add tests",
    });

    expect(result.content[0]?.text).toContain("Detected pack: software");
    expect(result.details.pack.name).toBe("software");
    expect(result.details.score).toBeGreaterThan(0.8);
  });

  it("lists available built-in packs", async () => {
    const graph = new ESRGraph();
    const { pi, tools } = createPiStub();

    await registerTools(pi as never, graph, packs);

    const result = await runTool(tools, "esr_list_packs", {});

    expect(result.content[0]?.text).toContain("Available packs (4)");
    expect(result.content[0]?.text).toContain("govdoc@0.1.0");
    expect(result.content[0]?.text).toContain("planning-review@0.1.0");
    expect(result.content[0]?.text).toContain("software@0.1.0");
    expect(result.details.packs).toHaveLength(4);
  });

  it("expands a goal with the software pack into ESR state", async () => {
    const graph = new ESRGraph();
    const { pi, tools, entries } = createPiStub();

    await registerTools(pi as never, graph, packs);

    const result = await runTool(tools, "esr_expand_with_pack", {
      goal: "fix login bug and add tests",
      pack_name: "software",
    });

    expect(result.content[0]?.text).toContain("Expanded with pack: software");
    expect(graph.getEntity("task-main")?.role).toBe("Task");
    expect(graph.getEntity("task-main")?.label).toBe("fix login bug and add tests");
    expect(graph.getAllEntities().filter((entity) => entity.role === "Constraint")).toHaveLength(2);
    expect(entries.length).toBeGreaterThan(0);
  });

  it("verifies the software pack scenario through task and closure views", async () => {
    const graph = new ESRGraph();
    const { pi, tools } = createPiStub();

    await registerTools(pi as never, graph, packs);
    await runTool(tools, "esr_expand_with_pack", {
      goal: "refactor auth module and add tests",
      pack_name: "software",
    });
    await runTool(tools, "esr_update_state", {
      entity_id: "task-main",
      state: "active",
    });
    await runTool(tools, "esr_create_entity", {
      entity_id: "actor-software-pack",
      role: "Actor",
      state: "stable",
    });
    await runTool(tools, "esr_update_artifact", {
      id: "src/auth.ts",
      type: "code",
      sections: [{ name: "main", state: "stable" }],
    });
    await runTool(tools, "esr_link_relation", {
      from: "task-main",
      to: "src/auth.ts",
      type: "produces",
    });
    await runTool(tools, "esr_evaluate", {
      entity_id: "task-main",
      evaluator: "actor-software-pack",
      confidence: 0.94,
      metrics: { tests: 6 },
    });
    for (const constraint of graph.getAllEntities().filter((entity) => entity.role === "Constraint")) {
      await runTool(tools, "esr_update_state", {
        entity_id: constraint.entity_id,
        state: "stable",
      });
    }

    const taskList = await runTool(tools, "esr_list_tasks", {
      state: "active",
    });
    const closure = await runTool(tools, "esr_get_closure_status", {
      task_id: "task-main",
    });

    expect(taskList.content[0]?.text).toContain("task-main");
    expect(taskList.content[0]?.text).toContain("closure=ready");
    expect(taskList.details.items[0]?.ready_for_stable).toBe(true);
    expect(closure.details.closure.ready_for_stable).toBe(true);
    expect(closure.details.closure.missing).toEqual([]);
  });

  it("detects the govdoc domain pack for proposal-style goals", async () => {
    const graph = new ESRGraph();
    const { pi, tools } = createPiStub();

    await registerTools(pi as never, graph, packs);

    const result = await runTool(tools, "esr_detect_pack", {
      prompt: "写一个公文式项目申请书，包含预算和政策依据",
    });

    expect(result.content[0]?.text).toContain("Detected pack: govdoc");
    expect(result.details.pack.name).toBe("govdoc");
    expect(result.details.score).toBeGreaterThan(0.85);
  });

  it("detects the planning-review pack for planning audit goals", async () => {
    const graph = new ESRGraph();
    const { pi, tools } = createPiStub();

    await registerTools(pi as never, graph, packs);

    const result = await runTool(tools, "esr_detect_pack", {
      prompt: "编写十五五规划审核报告，检查战略对齐和整改跟踪",
    });

    expect(result.content[0]?.text).toContain("Detected pack: planning-review");
    expect(result.details.pack.name).toBe("planning-review");
    expect(result.details.score).toBeGreaterThan(0.9);
  });

  it("routes a real fifteen-five planning review prompt to planning-review", async () => {
    const graph = new ESRGraph();
    const { pi, tools } = createPiStub();

    await registerTools(pi as never, graph, packs);

    const result = await runTool(tools, "esr_detect_pack", {
      prompt: "审核十五五规划待审核稿，检查战略对齐、指标完整性、数据一致性，并输出审核报告和整改跟踪建议",
    });

    expect(result.content[0]?.text).toContain("Detected pack: planning-review");
    expect(result.details.pack.name).toBe("planning-review");
  });

  it("expands a goal with the planning-review pack into ESR state", async () => {
    const graph = new ESRGraph();
    const { pi, tools } = createPiStub();

    await registerTools(pi as never, graph, packs);

    const result = await runTool(tools, "esr_expand_with_pack", {
      goal: "审核十五五规划并输出问题清单和整改建议",
      pack_name: "planning-review",
    });

    expect(result.content[0]?.text).toContain("Expanded with pack: planning-review");
    expect(graph.getEntity("planning-document")?.role).toBe("Artifact");
    expect(graph.getEntity("review-strategy-alignment")?.role).toBe("Task");
    expect(graph.getArtifact("planning-review-report")).toBeDefined();
    expect(graph.getAllEntities().filter((entity) => entity.role === "Constraint")).toHaveLength(5);
    expect(result.details.checks).toHaveLength(5);
    expect(result.details.reference_baselines).toHaveLength(1);
    expect(result.details.reference_baselines[0]?.id).toBe("national-standard-requirements");
    expect(result.details.reference_baselines[0]?.sourceType).toBe("requirement");
    expect(result.details.gaps).toContain("missing_requirement_section:范围");
    expect(result.details.gaps).not.toContain("missing_rectification_tracking");
  });

  it("surfaces requirement gaps but keeps review-chain signals for a realistic planning review goal", async () => {
    const graph = new ESRGraph();
    const { pi, tools } = createPiStub();

    await registerTools(pi as never, graph, packs);

    const result = await runTool(tools, "esr_expand_with_pack", {
      goal: "审核十五五规划待审核稿，已覆盖战略衔接、指标体系、数据测算口径、审查意见和整改台账，需补齐与国家标准要求的符合性响应",
      pack_name: "planning-review",
    });

    expect(result.content[0]?.text).toContain("Expanded with pack: planning-review");
    expect(result.details.gaps).not.toContain("missing_strategy_alignment");
    expect(result.details.gaps).not.toContain("missing_indicator_completeness");
    expect(result.details.gaps).not.toContain("missing_data_consistency");
    expect(result.details.gaps).not.toContain("missing_review_report");
    expect(result.details.gaps).not.toContain("missing_rectification_tracking");
    expect(result.details.gaps).toContain("missing_requirement_section:范围");
    expect(result.details.baseline_diffs[0]?.baselineId).toBe("national-standard-requirements");
    expect(result.details.baseline_diffs[0]?.missingSections).toContain("范围");
    expect(result.details.baseline_diffs[0]?.suggestions).toContain("补齐要求章节：范围");
    expect(result.details.review_findings.some((item: any) => item.category === "requirement" && item.title.includes("范围"))).toBe(true);
    expect(result.details.remediation_items.some((item: any) => item.findingId === "requirement-section-范围" && item.ownerHint === "规划起草组")).toBe(true);
    expect(result.details.remediation_items.some((item: any) => item.findingId === "requirement-section-范围" && item.suggestedStatus === "open")).toBe(true);
    expect(result.details.remediation_items.some((item: any) => item.acceptance.includes("国家标准要求"))).toBe(true);
  });

  it("expands a goal with the govdoc pack into ESR state", async () => {
    const graph = new ESRGraph();
    const { pi, tools } = createPiStub();

    await registerTools(pi as never, graph, packs);

    const result = await runTool(tools, "esr_expand_with_pack", {
      goal: "写一个数据基础设施项目立项书",
      pack_name: "govdoc",
    });

    expect(result.content[0]?.text).toContain("Expanded with pack: govdoc");
    expect(graph.getEntity("proposal-main")?.role).toBe("Artifact");
    expect(graph.getEntity("section-background")?.role).toBe("Task");
    expect(graph.getEntity("section-budget")?.role).toBe("Task");
    expect(graph.getArtifact("proposal.docx")).toBeDefined();
    expect(graph.getArtifact("budget-sheet")).toBeDefined();
    expect(graph.getArtifact("risk-matrix")).toBeDefined();
    expect(graph.getAllRelations().filter((relation) => relation.type === "part_of")).toHaveLength(4);
    expect(graph.getAllEntities().filter((entity) => entity.role === "Constraint")).toHaveLength(4);
  });

  it("verifies the govdoc pack scenario through pack expansion and task views", async () => {
    const graph = new ESRGraph();
    const { pi, tools } = createPiStub();

    await registerTools(pi as never, graph, packs);
    await runTool(tools, "esr_expand_with_pack", {
      goal: "写一个数据基础设施项目立项书",
      pack_name: "govdoc",
    });
    await runTool(tools, "esr_update_state", {
      entity_id: "section-budget",
      state: "active",
    });
    await runTool(tools, "esr_update_state", {
      entity_id: "section-risk",
      state: "active",
    });

    const taskList = await runTool(tools, "esr_list_tasks", {
      include_ready: true,
    });
    const closureGaps = await runTool(tools, "esr_list_closure_gaps", {
      include_ready: true,
    });

    expect(taskList.content[0]?.text).toContain("section-budget");
    expect(taskList.content[0]?.text).toContain("section-risk");
    expect(taskList.details.items.length).toBeGreaterThanOrEqual(4);
    expect(closureGaps.content[0]?.text).toContain("section-budget");
    expect(closureGaps.content[0]?.text).toContain("missing artifact, evaluation");
  });

  it("verifies govdoc validation signals can improve with attached policy memory refs", async () => {
    const graph = new ESRGraph();
    const { pi, tools } = createPiStub();

    await registerTools(pi as never, graph, packs);
    await runTool(tools, "esr_expand_with_pack", {
      goal: "写一个项目立项书",
      pack_name: "govdoc",
    });

    const before = await runTool(tools, "esr_expand_with_pack", {
      goal: "写一个项目立项书",
      pack_name: "govdoc",
    });

    expect(before.details.summary).toContain("GovDoc validation");

    await runTool(tools, "esr_attach_memory_ref", {
      entity_id: "proposal-main",
      ref_id: "policy-ref-1",
      provider: "claude-mem",
      kind: "summary",
      title: "政策依据汇总",
    });

    const taskList = await runTool(tools, "esr_list_tasks", {
      include_ready: true,
    });

    expect(graph.getMemoryRefs("proposal-main")).toHaveLength(1);
    expect(taskList.details.items.some((item: any) => item.task_id === "section-budget")).toBe(true);
  });
});
