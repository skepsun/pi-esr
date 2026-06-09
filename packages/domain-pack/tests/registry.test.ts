import { describe, expect, it } from "vitest";
import { createBuiltinPackRegistry, detectBestPack } from "../src/index.js";

describe("domain pack registry", () => {
  it("lists built-in packs in stable order", () => {
    const registry = createBuiltinPackRegistry();
    const packs = registry.list();

    expect(packs.map((pack) => pack.name)).toEqual(["govdoc", "planning-review", "software"]);
  });

  it("detects software pack for coding prompts", async () => {
    const registry = createBuiltinPackRegistry();
    const result = await detectBestPack(registry.list(), {
      prompt: "refactor the TypeScript module and add tests",
      cwd: process.cwd(),
      host: "test",
    });

    expect(result.pack?.name).toBe("software");
    expect(result.score).toBeGreaterThan(0.8);
  });

  it("detects govdoc pack for proposal prompts", async () => {
    const registry = createBuiltinPackRegistry();
    const result = await detectBestPack(registry.list(), {
      prompt: "写一个项目立项书并补充预算和政策依据",
      cwd: process.cwd(),
      host: "test",
    });

    expect(result.pack?.name).toBe("govdoc");
    expect(result.score).toBeGreaterThan(0.85);
  });

  it("detects planning-review pack for planning audit prompts", async () => {
    const registry = createBuiltinPackRegistry();
    const result = await detectBestPack(registry.list(), {
      prompt: "编写十五五规划审核报告，检查战略对齐、指标体系和整改闭环",
      cwd: process.cwd(),
      host: "test",
    });

    expect(result.pack?.name).toBe("planning-review");
    expect(result.score).toBeGreaterThan(0.9);
  });

  it("validates govdoc context and reports missing policy reference", async () => {
    const registry = createBuiltinPackRegistry();
    const pack = registry.get("govdoc");

    if (!pack) {
      throw new Error("govdoc pack not registered");
    }

    const result = await pack.validate({
      cwd: process.cwd(),
      context: "section-budget section-risk budget-sheet risk-matrix",
    });

    expect(result.gaps).toContain("missing_policy_reference");
    expect(result.summary).toContain("GovDoc validation gaps");
  });

  it("passes govdoc validation when budget risk and policy signals exist", async () => {
    const registry = createBuiltinPackRegistry();
    const pack = registry.get("govdoc");

    if (!pack) {
      throw new Error("govdoc pack not registered");
    }

    const result = await pack.validate({
      cwd: process.cwd(),
      context: "section-budget section-risk budget-sheet risk-matrix 政策依据",
    });

    expect(result.gaps).toEqual([]);
    expect(result.summary).toContain("GovDoc validation passed");
  });

  it("reports planning-review validation gaps when audit signals are incomplete", async () => {
    const registry = createBuiltinPackRegistry();
    const pack = registry.get("planning-review");

    if (!pack) {
      throw new Error("planning-review pack not registered");
    }

    const result = await pack.validate({
      cwd: process.cwd(),
      context: "战略 指标 数据",
    });

    expect(result.gaps).toContain("missing_review_report");
    expect(result.gaps).toContain("missing_rectification_tracking");
    expect(result.gaps).toContain("missing_requirement_section:范围");
    expect(result.gaps).toContain("missing_requirement_signal:符合性");
  });

  it("exposes planning-review checks metadata in expansion", async () => {
    const registry = createBuiltinPackRegistry();
    const pack = registry.get("planning-review");

    if (!pack) {
      throw new Error("planning-review pack not registered");
    }

    const expansion = await pack.expand({
      cwd: process.cwd(),
      goal: "审核十五五规划",
    });

    expect(expansion.checks?.map((item) => item.id)).toEqual([
      "chapter_completeness",
      "section_mapping",
      "indicator_coverage",
      "measure_concreteness",
      "style_consistency",
    ]);
    expect(expansion.referenceBaselines?.[0]?.id).toBe("national-standard-requirements");
    expect(expansion.referenceBaselines?.[0]?.sourceType).toBe("requirement");
    expect(expansion.referenceBaselines?.[0]?.sections).toContain("总体要求");
    expect(expansion.referenceBaselines?.[0]?.signals).toContain("符合性");
  });

  it("passes baseline-driven validation when reference sections and signals are present", async () => {
    const registry = createBuiltinPackRegistry();
    const pack = registry.get("planning-review");

    if (!pack) {
      throw new Error("planning-review pack not registered");
    }

    const result = await pack.validate({
      cwd: process.cwd(),
      context: "战略 指标 数据 报告 整改 范围 术语和定义 总体要求 实施要求 评价与改进 符合性 术语一致 实施路径 责任分工 持续改进",
    });

    expect(result.gaps).not.toContain("missing_requirement_section:范围");
    expect(result.gaps).not.toContain("missing_requirement_signal:符合性");
  });

  it("keeps audit-chain signals while exposing requirement gaps for a realistic draft summary", async () => {
    const registry = createBuiltinPackRegistry();
    const pack = registry.get("planning-review");

    if (!pack) {
      throw new Error("planning-review pack not registered");
    }

    const result = await pack.validate({
      cwd: process.cwd(),
      context: "本次待审核稿包含战略衔接、指标体系、数据测算口径、审查意见和整改台账，已形成总体要求、实施要求两章内容。",
    });

    expect(result.gaps).not.toContain("missing_strategy_alignment");
    expect(result.gaps).not.toContain("missing_indicator_completeness");
    expect(result.gaps).not.toContain("missing_data_consistency");
    expect(result.gaps).not.toContain("missing_review_report");
    expect(result.gaps).not.toContain("missing_rectification_tracking");
    expect(result.gaps).toContain("missing_requirement_section:范围");
    expect(result.gaps).toContain("missing_requirement_section:术语和定义");
    expect(result.gaps).toContain("missing_requirement_signal:符合性");
    expect(result.baselineDiffs?.[0]?.baselineId).toBe("national-standard-requirements");
    expect(result.baselineDiffs?.[0]?.missingSections).toContain("范围");
    expect(result.baselineDiffs?.[0]?.missingSignals).toContain("符合性");
    expect(result.baselineDiffs?.[0]?.weakSignals).toContain("实施路径");
    expect(result.baselineDiffs?.[0]?.suggestions).toContain("补齐要求章节：范围");
    expect(result.reviewFindings?.some((item) => item.category === "requirement" && item.title.includes("范围"))).toBe(true);
    expect(result.reviewFindings?.some((item) => item.category === "requirement" && item.title.includes("实施路径"))).toBe(true);
    expect(result.remediationItems?.some((item) => item.findingId === "requirement-section-范围" && item.ownerHint === "规划起草组")).toBe(true);
    expect(result.remediationItems?.some((item) => item.findingId === "requirement-section-范围" && item.suggestedStatus === "open")).toBe(true);
    expect(result.remediationItems?.some((item) => item.traceToBaseline?.includes("国家标准要求来源"))).toBe(true);
  });
});
