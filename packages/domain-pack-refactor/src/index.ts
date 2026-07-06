import type {
  ESRDomainPack,
  ESRPackBaselineDiff,
  ESRPackExpansion,
  ESRPackReferenceBaseline,
  ESRPackRemediationItem,
  ESRPackReviewFinding,
  ESRPackValidationResult,
} from "../../domain-pack/src/index.js";

// ── Baseline: refactoring safety contract ───────────────────────────────

const REFACTOR_BASELINE: ESRPackReferenceBaseline = {
  id: "refactor-safety-requirements",
  label: "Refactoring Safety Contract",
  sourceType: "requirement",
  sections: [
    "Understand Current Behavior",
    "Public API Surface",
    "Call Site Inventory",
    "Test Baseline",
    "Migration Path",
    "Behavior Verification",
    "Documentation Update",
  ],
  signals: [
    "PublicAPI",
    "CallSites",
    "TestPassing",
    "NoNewCycles",
    "DiffSummary",
    "MigrationGuide",
    "RollbackPlan",
  ],
};

const REFACTOR_CHECKS = [
  {
    id: "public_api_stability",
    label: "Public API Stability",
    description:
      "Verify the public API surface (exports, interfaces, public methods) is unchanged or intentionally evolved with migration path.",
  },
  {
    id: "test_regression_safety",
    label: "Test Regression Safety",
    description:
      "Confirm all existing tests pass before and after the refactor with zero regressions.",
  },
  {
    id: "call_site_completeness",
    label: "Call Site Completeness",
    description:
      "Every call site of the refactored code is identified and migrated — no orphaned or broken references.",
  },
  {
    id: "circular_dependency_prevention",
    label: "Circular Dependency Prevention",
    description:
      "No new import cycles introduced. Module dependency graph remains acyclic.",
  },
  {
    id: "behavior_verification",
    label: "Behavior Verification",
    description:
      "External behavior is preserved. If behavior intentionally changes, it is documented as a breaking change.",
  },
];

// ── Pack ────────────────────────────────────────────────────────────────

export const refactorPack: ESRDomainPack = {
  name: "refactor",
  version: "0.6.3",
  description:
    "Refactoring pack: understand current → extract interface → migrate callers → remove old → verify behavior → update docs.",

  async detect(input) {
    const text = input.prompt.toLowerCase();
    const signals = [
      /\brefactor\b/,
      /\bextract\b/,
      /\binline\b/,
      /\brename\b/,
      /\bmove\s*(module|file|class|function)/,
      /\bsplit\s*(module|file|class|function)/,
      /\bmerge\b/,
      /\bsimplify\b/,
      /\brestructure\b/,
      /\breorganize\b/,
      /\bclean\s*up\b/,
      /\bdecouple\b/,
      /\bunify\b/,
    ];
    const matchCount = signals.filter((re) => re.test(text)).length;

    if (matchCount >= 2) return 0.92;
    if (matchCount === 1) return 0.75;

    // Broad match: refactoring-related language
    if (/(refactor|extract|module|split|cleanup|decouple|restructure)/.test(text)) {
      return 0.35;
    }
    return 0.1;
  },

  async expand(input): Promise<ESRPackExpansion> {
    return {
      entities: [
        {
          entity_id: "task-refactor",
          role: "Task",
          state: "draft",
          label: input.goal,
          confidence: 0.5,
        },
        {
          entity_id: "task-understand-current",
          role: "Task",
          state: "draft",
          label: "Audit current behavior: public API, call sites, tests",
          confidence: 0.4,
        },
        {
          entity_id: "task-extract-interface",
          role: "Task",
          state: "draft",
          label: "Define new interface / module boundary",
          confidence: 0.4,
        },
        {
          entity_id: "task-migrate-callers",
          role: "Task",
          state: "draft",
          label: "Migrate all call sites to new API / interface",
          confidence: 0.4,
        },
        {
          entity_id: "task-remove-old-code",
          role: "Task",
          state: "draft",
          label: "Remove deprecated code and dead paths",
          confidence: 0.4,
        },
        {
          entity_id: "task-verify-behavior",
          role: "Task",
          state: "draft",
          label: "Run tests and verify external behavior unchanged",
          confidence: 0.4,
        },
        {
          entity_id: "task-update-docs",
          role: "Task",
          state: "draft",
          label: "Update documentation, migration guide, and changelog",
          confidence: 0.4,
        },
      ],
      relations: [
        { from: "task-understand-current", to: "task-refactor", type: "part_of" },
        { from: "task-extract-interface", to: "task-refactor", type: "part_of" },
        { from: "task-migrate-callers", to: "task-refactor", type: "part_of" },
        { from: "task-remove-old-code", to: "task-refactor", type: "part_of" },
        { from: "task-verify-behavior", to: "task-refactor", type: "part_of" },
        { from: "task-update-docs", to: "task-refactor", type: "part_of" },
        // Sequential dependency chain
        { from: "task-extract-interface", to: "task-understand-current", type: "depends_on" },
        { from: "task-migrate-callers", to: "task-extract-interface", type: "depends_on" },
        { from: "task-remove-old-code", to: "task-migrate-callers", type: "depends_on" },
        { from: "task-verify-behavior", to: "task-remove-old-code", type: "depends_on" },
        { from: "task-update-docs", to: "task-verify-behavior", type: "depends_on" },
      ],
      artifacts: [
        {
          id: "refactor-plan.md",
          type: "document",
          sections: [
            { name: "current-state", state: "draft" },
            { name: "target-state", state: "draft" },
            { name: "migration-steps", state: "draft" },
            { name: "rollback-plan", state: "draft" },
          ],
        },
        {
          id: "public-api-audit.md",
          type: "document",
          sections: [
            { name: "exports", state: "draft" },
            { name: "call-sites", state: "draft" },
            { name: "breaking-changes", state: "draft" },
          ],
        },
      ],
      constraints: [
        { entity_id: "task-refactor", description: "must_preserve_public_api" },
        { entity_id: "task-refactor", description: "must_pass_existing_tests" },
        { entity_id: "task-refactor", description: "must_update_all_call_sites" },
        { entity_id: "task-refactor", description: "must_not_introduce_circular_deps" },
        { entity_id: "task-refactor", description: "must_document_changes" },
      ],
      checks: REFACTOR_CHECKS,
      referenceBaselines: [REFACTOR_BASELINE],
      summary:
        "Refactor pack initialized: understand current → extract interface → migrate callers → remove old → verify behavior → update docs.",
    };
  },

  async validate(input): Promise<ESRPackValidationResult> {
    const context = input.context.toLowerCase();
    const baseline = REFACTOR_BASELINE;
    const hasAny = (patterns: RegExp[]) =>
      patterns.some((p) => p.test(context));

    const gaps: string[] = [];
    const missingSections: string[] = [];
    const missingSignals: string[] = [];
    const weakSignals: string[] = [];

    // ── Public API awareness ──────────────────────────────────────────
    if (!hasAny([/public.?api|api.*surface|export|interface|公共/])) {
      gaps.push("missing_public_api_analysis");
    }
    if (hasAny([/export|interface|api/]) && !hasAny([/backward|compat|兼容|unchanged/])) {
      weakSignals.push("Backward-compatibility statement");
    }

    // ── Call site inventory ───────────────────────────────────────────
    if (!hasAny([/call.?site|caller|import.*change|引用|调用方/])) {
      gaps.push("missing_call_site_inventory");
    }

    // ── Test baseline ─────────────────────────────────────────────────
    if (!hasAny([/test.*pass|pass.*test|回归|regression/])) {
      gaps.push("missing_test_baseline");
    }

    // ── Circular dependency awareness ─────────────────────────────────
    if (!hasAny([/circular|cycle|import.?loop|循环依赖/])) {
      gaps.push("missing_circular_dep_check");
    }

    // ── Migration path ────────────────────────────────────────────────
    if (!hasAny([/migration|migrate|迁移|过渡|deprecat/])) {
      gaps.push("missing_migration_path");
    }

    // ── Documentation ─────────────────────────────────────────────────
    if (!hasAny([/doc|changelog|readme|文档/])) {
      gaps.push("missing_documentation_update");
    }

    // ── Rollback plan ─────────────────────────────────────────────────
    if (!hasAny([/rollback|revert|回滚|undo/])) {
      weakSignals.push("Rollback plan");
    }

    // ── Baseline section coverage ─────────────────────────────────────
    for (const section of baseline.sections) {
      const sec = section.toLowerCase().replace(/\s/g, "");
      if (!context.includes(sec) && !context.includes(section.toLowerCase())) {
        missingSections.push(section);
        gaps.push(`missing_refactor_section:${section}`);
      }
    }

    // ── Baseline signal coverage ──────────────────────────────────────
    for (const signal of baseline.signals) {
      const sig = signal.toLowerCase();
      if (!context.includes(sig) && !context.includes(sig.replace(/\s/g, ""))) {
        missingSignals.push(signal);
        gaps.push(`missing_refactor_signal:${signal}`);
      }
    }

    // ── Weak signal detection ─────────────────────────────────────────
    if (hasAny([/test|测试/]) && !hasAny([/coverage|覆盖率|100%/])) {
      weakSignals.push("Test coverage target");
    }
    if (hasAny([/migrat|迁移/]) && !hasAny([/step|步骤|phase|阶段/])) {
      weakSignals.push("Phased migration steps");
    }

    // ── Build baseline diffs ──────────────────────────────────────────
    const baselineDiffs: ESRPackBaselineDiff[] = [
      {
        baselineId: baseline.id,
        missingSections,
        missingSignals,
        weakSignals,
        suggestions: [
          ...missingSections.map((s) => `Add refactoring section: ${s}`),
          ...missingSignals.map((s) => `Add safety signal: ${s}`),
          ...weakSignals.map((s) => `Strengthen safety signal: ${s}`),
        ],
      },
    ];

    // ── Review findings ───────────────────────────────────────────────
    const reviewFindings: ESRPackReviewFinding[] = [
      ...missingSections.map((section) => ({
        id: `refactor-section-${section.toLowerCase().replace(/\s/g, "-")}`,
        severity: "high" as const,
        category: "requirement" as const,
        title: `Missing refactoring step: ${section}`,
        summary: `The refactoring plan does not cover the required step "${section}".`,
        evidence: [baseline.label, section],
        recommendations: [`Add a plan section for "${section}" with concrete actions.`],
      })),
      ...missingSignals.map((signal) => ({
        id: `refactor-signal-${signal}`,
        severity: "medium" as const,
        category: "requirement" as const,
        title: `Missing safety check: ${signal}`,
        summary: `The refactoring is missing the safety signal "${signal}".`,
        evidence: [baseline.label, signal],
        recommendations: [
          `Add "${signal}" verification step to the refactoring plan or implementation.`,
        ],
      })),
      ...weakSignals.map((signal) => ({
        id: `weak-refactor-${signal.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
        severity: "low" as const,
        category: "weak_signal" as const,
        title: `Weak safety signal: ${signal}`,
        summary: `The refactoring mentions related concepts but "${signal}" is not explicitly addressed.`,
        evidence: [baseline.label, signal],
        recommendations: [
          `Explicitly document "${signal}" as part of the refactoring plan.`,
        ],
      })),
    ];

    // ── Remediation items ─────────────────────────────────────────────
    const remediationItems: ESRPackRemediationItem[] = reviewFindings.map(
      (finding) => ({
        id: `remediate-${finding.id}`,
        findingId: finding.id,
        priority: finding.severity,
        suggestedStatus: "open" as const,
        action: finding.recommendations[0] ?? `Address: ${finding.title}`,
        ownerHint: finding.title.includes("step") || finding.title.includes("section")
          ? "Refactoring Lead"
          : "Developer + Reviewer",
        traceToBaseline: finding.evidence[0],
        acceptance: finding.title.includes("step")
          ? "Plan section added with concrete actions and acceptance criteria."
          : "Safety signal addressed with automated check or manual verification step.",
      }),
    );

    return {
      evaluations: [],
      constraints: [],
      memoryRefs: [],
      gaps,
      baselineDiffs,
      reviewFindings,
      remediationItems,
      summary:
        gaps.length === 0
          ? "Refactor validation passed: API stability, call sites, tests, circular deps, migration, and docs are all addressed."
          : `Refactor validation gaps: ${gaps.join(", ")}`,
    };
  },
};
