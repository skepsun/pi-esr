import type {
  ESRDomainPack,
  ESRPackBaselineDiff,
  ESRPackExpansion,
  ESRPackReferenceBaseline,
  ESRPackRemediationItem,
  ESRPackReviewFinding,
  ESRPackValidationResult,
} from "../../domain-pack/src/index.js";

const REFERENCE_BASELINES: ESRPackReferenceBaseline[] = [
  {
    id: "national-standard-requirements",
    label: "国家标准要求来源",
    sourceType: "requirement",
    sections: [
      "范围",
      "术语和定义",
      "总体要求",
      "实施要求",
      "评价与改进",
    ],
    signals: [
      "符合性",
      "术语一致",
      "实施路径",
      "责任分工",
      "持续改进",
    ],
  },
];

export const planningReviewPack: ESRDomainPack = {
  name: "planning-review",
  version: "0.6.3",
  description: "Planning review pack for strategy alignment, indicator completeness, and audit closure.",

  async detect(input) {
    const text = input.prompt.toLowerCase();
    if (/(十五五|规划审核|审核报告|整改|战略对齐|指标体系|规划|立项书|审查)/.test(text)) {
      return 0.95;
    }
    return 0.1;
  },

  async expand(input): Promise<ESRPackExpansion> {
    return {
      entities: [
        {
          entity_id: "planning-document",
          role: "Artifact",
          state: "draft",
          label: input.goal,
          confidence: 0.5,
        },
        {
          entity_id: "review-strategy-alignment",
          role: "Task",
          state: "draft",
          label: "战略对齐审核",
          confidence: 0.4,
        },
        {
          entity_id: "review-indicator-completeness",
          role: "Task",
          state: "draft",
          label: "指标完整性审核",
          confidence: 0.4,
        },
        {
          entity_id: "review-text-data-consistency",
          role: "Task",
          state: "draft",
          label: "文本与数据一致性审核",
          confidence: 0.4,
        },
        {
          entity_id: "review-report-output",
          role: "Task",
          state: "draft",
          label: "审核报告输出",
          confidence: 0.4,
        },
      ],
      relations: [
        { from: "review-strategy-alignment", to: "planning-document", type: "part_of" },
        { from: "review-indicator-completeness", to: "planning-document", type: "part_of" },
        { from: "review-text-data-consistency", to: "planning-document", type: "part_of" },
        { from: "review-report-output", to: "planning-document", type: "part_of" },
      ],
      artifacts: [
        {
          id: "planning-source.docx",
          type: "document",
          sections: [
            { name: "overall-goal", state: "draft" },
            { name: "indicators", state: "draft" },
            { name: "measures", state: "draft" },
            { name: "guarantees", state: "draft" },
          ],
        },
        {
          id: "planning-review-report",
          type: "report",
          sections: [
            { name: "findings", state: "draft" },
            { name: "issues", state: "draft" },
            { name: "suggestions", state: "draft" },
          ],
        },
      ],
      constraints: [
        { entity_id: "planning-document", description: "must_have_complete_sections" },
        { entity_id: "planning-document", description: "must_align_with_group_strategy" },
        { entity_id: "planning-document", description: "must_have_complete_indicators" },
        { entity_id: "planning-document", description: "must_have_consistent_data" },
        { entity_id: "planning-document", description: "must_output_review_report" },
      ],
      checks: [
        {
          id: "chapter_completeness",
          label: "章节完整性审核",
          description: "检查章节缺失、顺序异常、新增章节、合并与拆分章节。",
        },
        {
          id: "section_mapping",
          label: "章节映射审核",
          description: "对模板结构与文档结构进行语义匹配和映射。",
        },
        {
          id: "indicator_coverage",
          label: "指标完整性审核",
          description: "检查关键指标是否完整、口径是否一致、是否存在缺项。",
        },
        {
          id: "measure_concreteness",
          label: "举措内容逻辑性审核",
          description: "检查举措是否包含量化指标、执行动词与落地路径。",
        },
        {
          id: "style_consistency",
          label: "行文规范审核",
          description: "检查术语统一、错别字、格式规范与重复内容。",
        },
      ],
      referenceBaselines: REFERENCE_BASELINES,
      summary: "Planning review pack initialized planning document review tasks, report artifacts, and audit constraints.",
    };
  },

  async validate(input): Promise<ESRPackValidationResult> {
    const context = input.context.toLowerCase();
    const gaps: string[] = [];
    const baseline = REFERENCE_BASELINES[0];
    const hasAny = (patterns: RegExp[]) => patterns.some((pattern) => pattern.test(context));
    const missingSections: string[] = [];
    const missingSignals: string[] = [];
    const weakSignals: string[] = [];
    const missingRequirements: string[] = [];

    if (!hasAny([/strategy/, /战略/, /对齐/, /衔接/])) {
      gaps.push("missing_strategy_alignment");
    }
    if (!hasAny([/indicator/, /指标/, /量化/, /目标值/, /指标体系/])) {
      gaps.push("missing_indicator_completeness");
    }
    if (!hasAny([/consistency/, /一致性/, /数据/, /口径/, /测算/])) {
      gaps.push("missing_data_consistency");
    }
    if (!hasAny([/report/, /报告/, /审查意见/, /审核意见/, /问题清单/])) {
      gaps.push("missing_review_report");
    }
    if (!hasAny([/整改/, /track/, /追溯/, /闭环/, /台账/, /销号/])) {
      gaps.push("missing_rectification_tracking");
    }

    for (const section of baseline.sections) {
      if (!context.includes(section.toLowerCase())) {
        missingSections.push(section);
        gaps.push(`missing_requirement_section:${section}`);
      }
    }
    for (const signal of baseline.signals) {
      if (!context.includes(signal.toLowerCase())) {
        missingSignals.push(signal);
        missingRequirements.push(signal);
        gaps.push(`missing_requirement_signal:${signal}`);
      }
    }

    if (hasAny([/术语/, /定义/]) && !context.includes("术语一致")) {
      weakSignals.push("术语一致");
    }
    if (hasAny([/实施/, /举措/, /路径/]) && !context.includes("实施路径")) {
      weakSignals.push("实施路径");
    }
    if (hasAny([/整改/, /责任/, /分工/]) && !context.includes("责任分工")) {
      weakSignals.push("责任分工");
    }

    const baselineDiffs: ESRPackBaselineDiff[] = [{
      baselineId: baseline.id,
      missingSections,
      missingSignals,
      weakSignals,
      suggestions: [
        ...missingSections.map((section) => `补齐要求章节：${section}`),
        ...missingSignals.map((signal) => `补充要求响应：${signal}`),
        ...weakSignals.map((signal) => `增强要求响应：${signal}`),
      ],
    }];

    const reviewFindings: ESRPackReviewFinding[] = [
      ...missingSections.map((section) => ({
        id: `requirement-section-${section}`,
        severity: "high" as const,
        category: "requirement" as const,
        title: `缺失要求章节：${section}`,
        summary: `待审核稿未覆盖国家标准要求来源中的章节“${section}”。`,
        evidence: [baseline.label, section],
        recommendations: [`补齐章节“${section}”并增加对应要求的响应说明。`],
      })),
      ...missingSignals.map((signal) => ({
        id: `requirement-signal-${signal}`,
        severity: "medium" as const,
        category: "requirement" as const,
        title: `缺失要求响应：${signal}`,
        summary: `待审核稿未明确回应国家标准要求中的关键信号“${signal}”。`,
        evidence: [baseline.label, signal],
        recommendations: [`补充“${signal}”对应的符合性说明、实施举措或责任安排。`],
      })),
      ...weakSignals.map((signal) => ({
        id: `weak-requirement-${signal}`,
        severity: "low" as const,
        category: "requirement" as const,
        title: `要求响应偏弱：${signal}`,
        summary: `文稿存在相关表达，但对要求信号“${signal}”的响应仍偏弱。`,
        evidence: [baseline.label, signal],
        recommendations: [`增强“${signal}”对应的响应说明、实施路径或责任分工。`],
      })),
    ];

    const remediationItems: ESRPackRemediationItem[] = reviewFindings.map((finding) => ({
      id: `remediate-${finding.id}`,
      findingId: finding.id,
      priority: finding.severity,
      suggestedStatus: "open",
      action: finding.recommendations[0] ?? `处理问题：${finding.title}`,
      ownerHint: finding.title.includes("章节")
        ? "规划起草组"
        : finding.title.includes("要求响应")
          ? "专题编制负责人"
          : "综合统稿人",
      traceToBaseline: finding.evidence[0],
      acceptance: finding.title.includes("章节")
        ? "对应要求章节已补齐，且包含对国家标准要求的响应说明。"
        : finding.title.includes("缺失要求响应")
          ? "相关要求已补充到文本、举措或责任安排，并可定位到具体章节。"
          : "相关要求响应已增强，且补充了实施路径或责任分工说明。",
    }));

    return {
      evaluations: [],
      constraints: [],
      memoryRefs: [],
      gaps,
      baselineDiffs,
      reviewFindings,
      remediationItems,
      summary: gaps.length === 0
        ? "Planning review validation passed: strategy, indicators, consistency, report, and tracking signals were found."
        : `Planning review validation gaps: ${gaps.join(", ")}`,
    };
  },
};
