import type {
  ESRDomainPack,
  ESRPackExpansion,
  ESRPackValidationResult,
} from "../../domain-pack/src/index.js";

export const govdocPack: ESRDomainPack = {
  name: "govdoc",
  version: "0.1.0",
  description: "Government and enterprise document pack for proposals, requests, and work reports.",

  async detect(input) {
    const text = input.prompt.toLowerCase();
    if (/(立项书|立项|申请书|请示|汇报|报告|预算|政策|公文|国企)/.test(text)) {
      return 0.9;
    }
    return 0.15;
  },

  async expand(input): Promise<ESRPackExpansion> {
    return {
      entities: [
        {
          entity_id: "proposal-main",
          role: "Artifact",
          state: "draft",
          label: input.goal,
          confidence: 0.5,
        },
        {
          entity_id: "section-background",
          role: "Task",
          state: "draft",
          label: "Background section",
          confidence: 0.4,
        },
        {
          entity_id: "section-goal",
          role: "Task",
          state: "draft",
          label: "Goal section",
          confidence: 0.4,
        },
        {
          entity_id: "section-budget",
          role: "Task",
          state: "draft",
          label: "Budget section",
          confidence: 0.4,
        },
        {
          entity_id: "section-risk",
          role: "Task",
          state: "draft",
          label: "Risk section",
          confidence: 0.4,
        },
      ],
      relations: [
        { from: "section-background", to: "proposal-main", type: "part_of" },
        { from: "section-goal", to: "proposal-main", type: "part_of" },
        { from: "section-budget", to: "proposal-main", type: "part_of" },
        { from: "section-risk", to: "proposal-main", type: "part_of" },
      ],
      artifacts: [
        {
          id: "proposal.docx",
          type: "document",
          sections: [
            { name: "background", state: "draft" },
            { name: "goal", state: "draft" },
            { name: "budget", state: "draft" },
            { name: "risk", state: "draft" },
          ],
        },
        {
          id: "budget-sheet",
          type: "report",
          sections: [{ name: "budget", state: "draft" }],
        },
        {
          id: "risk-matrix",
          type: "report",
          sections: [{ name: "risk", state: "draft" }],
        },
      ],
      constraints: [
        { entity_id: "proposal-main", description: "must_have_budget" },
        { entity_id: "proposal-main", description: "must_have_risk" },
        { entity_id: "proposal-main", description: "must_reference_policy" },
        { entity_id: "proposal-main", description: "no_fictional_policy" },
      ],
      summary: "GovDoc pack initialized a proposal document, section tasks, artifacts, and compliance constraints.",
    };
  },

  async validate(_input): Promise<ESRPackValidationResult> {
    const context = _input.context.toLowerCase();
    const hasBudget = /section-budget|budget-sheet|budget/.test(context);
    const hasRisk = /section-risk|risk-matrix|risk/.test(context);
    const hasPolicyReference = /policy|政策|memory_refs=|must_reference_policy/.test(context);

    const gaps: string[] = [];
    if (!hasBudget) gaps.push("missing_budget");
    if (!hasRisk) gaps.push("missing_risk");
    if (!hasPolicyReference) gaps.push("missing_policy_reference");

    return {
      evaluations: [],
      constraints: [],
      memoryRefs: [],
      gaps,
      summary: gaps.length === 0
        ? "GovDoc validation passed: budget, risk, and policy signals were found."
        : `GovDoc validation gaps: ${gaps.join(", ")}`,
    };
  },
};
