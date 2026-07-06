import type {
  ESRDomainPack,
  ESRPackBaselineDiff,
  ESRPackExpansion,
  ESRPackReferenceBaseline,
  ESRPackRemediationItem,
  ESRPackReviewFinding,
  ESRPackValidationResult,
} from "../../domain-pack/src/index.js";

// ── Baseline: agent tool contract requirements ──────────────────────────

const TOOL_CONTRACT_BASELINE: ESRPackReferenceBaseline = {
  id: "tool-contract-requirements",
  label: "Agent Tool Contract Requirements",
  sourceType: "requirement",
  sections: [
    "Interface Signature",
    "Input Schema",
    "Output Schema",
    "Error Classification",
    "Timeout Strategy",
    "Idempotency",
  ],
  signals: [
    "ToolName",
    "InputSchema",
    "OutputSchema",
    "ErrorType",
    "RetryableError",
    "FatalError",
    "AuthError",
    "Timeout",
    "Idempotent",
    "RateLimit",
  ],
};

const TOOL_CHECKS = [
  {
    id: "tool_contract_completeness",
    label: "Tool Contract Completeness",
    description:
      "Verify the tool defines complete input/output contracts: types, required fields, defaults, and edge-case semantics.",
  },
  {
    id: "input_schema_validity",
    label: "Input Schema Validity",
    description:
      "Check that input schemas are machine-validatable, boundary values are defined, and ambiguous types are avoided.",
  },
  {
    id: "error_classification",
    label: "Error Classification",
    description:
      "Check that errors are classified as retryable / fatal / auth / rate-limit with user-readable messages.",
  },
  {
    id: "timeout_strategy",
    label: "Timeout Strategy",
    description:
      "Verify timeout is defined, retry policy is reasonable, and backoff (exponential + jitter) is present.",
  },
  {
    id: "idempotency_analysis",
    label: "Idempotency Analysis",
    description:
      "Verify write operations are tagged with idempotency semantics; read operations declare caching policy.",
  },
];

// ── Pack ────────────────────────────────────────────────────────────────

export const agentToolPack: ESRDomainPack = {
  name: "agent-tool",
  version: "0.6.3",
  description:
    "Agent tool / MCP server / plugin development pack: tool contracts, schema design, error taxonomy, timeout strategy, and idempotency.",

  async detect(input) {
    const text = input.prompt.toLowerCase();
    const signals = [
      /\bmcp\b/,
      /\bplugin\b/,
      /\bextension\b/,
      /\btool\s*(server|definition|contract|handler)/,
      /\binput\s*schema\b/,
      /\boutput\s*schema\b/,
      /\berror\s*(classification|taxonomy|handling)/,
      /\bidempoten/,
      /\btimeout\s*(strategy|handling|policy)/,
      /\bretryable/,
    ];
    const matchCount = signals.filter((re) => re.test(text)).length;

    if (matchCount >= 2) return 0.92;
    if (matchCount === 1) return 0.75;

    if (/(tool|plugin|extension|handler|schema|endpoint|contract)/.test(text)) {
      return 0.4;
    }
    return 0.1;
  },

  async expand(input): Promise<ESRPackExpansion> {
    return {
      entities: [
        {
          entity_id: "task-tool-contract",
          role: "Task",
          state: "draft",
          label: input.goal,
          confidence: 0.5,
        },
        {
          entity_id: "task-input-schema",
          role: "Task",
          state: "draft",
          label: "Define input schema with validation rules",
          confidence: 0.4,
        },
        {
          entity_id: "task-error-handling",
          role: "Task",
          state: "draft",
          label: "Classify errors: retryable, fatal, auth, rate-limit",
          confidence: 0.4,
        },
        {
          entity_id: "task-timeout-strategy",
          role: "Task",
          state: "draft",
          label: "Define timeout and retry/backoff strategy",
          confidence: 0.4,
        },
        {
          entity_id: "task-idempotency",
          role: "Task",
          state: "draft",
          label: "Ensure idempotency for write operations",
          confidence: 0.4,
        },
        {
          entity_id: "task-integration-test",
          role: "Task",
          state: "draft",
          label: "Integration tests: happy path, error path, timeout, boundary",
          confidence: 0.4,
        },
      ],
      relations: [
        { from: "task-input-schema", to: "task-tool-contract", type: "part_of" },
        { from: "task-error-handling", to: "task-tool-contract", type: "part_of" },
        { from: "task-timeout-strategy", to: "task-tool-contract", type: "part_of" },
        { from: "task-idempotency", to: "task-tool-contract", type: "part_of" },
        { from: "task-integration-test", to: "task-tool-contract", type: "part_of" },
      ],
      artifacts: [
        {
          id: "tool-schema.ts",
          type: "code",
          sections: [
            { name: "interface", state: "draft" },
            { name: "input-schema", state: "draft" },
            { name: "output-schema", state: "draft" },
          ],
        },
        {
          id: "tool-handler.ts",
          type: "code",
          sections: [
            { name: "implementation", state: "draft" },
            { name: "error-throws", state: "draft" },
            { name: "timeout-wrap", state: "draft" },
            { name: "idempotency-guard", state: "draft" },
          ],
        },
        {
          id: "error-types.ts",
          type: "code",
          sections: [
            { name: "retryable", state: "draft" },
            { name: "fatal", state: "draft" },
            { name: "auth", state: "draft" },
            { name: "rate-limit", state: "draft" },
          ],
        },
        {
          id: "tool.test.ts",
          type: "code",
          sections: [
            { name: "happy-path", state: "draft" },
            { name: "error-cases", state: "draft" },
            { name: "timeout-simulation", state: "draft" },
            { name: "boundary-values", state: "draft" },
          ],
        },
      ],
      constraints: [
        { entity_id: "task-tool-contract", description: "must_define_input_schema" },
        { entity_id: "task-tool-contract", description: "must_define_output_schema" },
        { entity_id: "task-tool-contract", description: "must_classify_errors" },
        { entity_id: "task-tool-contract", description: "must_handle_timeout" },
        { entity_id: "task-tool-contract", description: "must_be_idempotent_for_writes" },
        { entity_id: "task-tool-contract", description: "must_pass_integration_tests" },
      ],
      checks: TOOL_CHECKS,
      referenceBaselines: [TOOL_CONTRACT_BASELINE],
      summary:
        "Agent-tool pack initialized tool contract, schema, error taxonomy, timeout, and idempotency tasks with integration test artifacts.",
    };
  },

  async validate(input): Promise<ESRPackValidationResult> {
    const context = input.context.toLowerCase();
    const baseline = TOOL_CONTRACT_BASELINE;
    const hasAny = (patterns: RegExp[]) =>
      patterns.some((p) => p.test(context));

    const gaps: string[] = [];
    const missingSections: string[] = [];
    const missingSignals: string[] = [];
    const weakSignals: string[] = [];

    // ── Contract completeness ─────────────────────────────────────────
    if (!hasAny([/input.?schema|parameters|入参/])) {
      gaps.push("missing_input_schema");
    }
    if (!hasAny([/output.?schema|result.?type|response.?schema|出参/])) {
      gaps.push("missing_output_schema");
    }

    // ── Error classification ──────────────────────────────────────────
    if (!hasAny([/retryable|retryableerror|可重试/])) {
      gaps.push("missing_retryable_error_classification");
    }
    if (!hasAny([/fatal.?error|fatalerror|non.?retryable|不可恢复/])) {
      gaps.push("missing_fatal_error_classification");
    }
    if (!hasAny([/auth.?error|autherror|401|403|permission.?denied|权限/])) {
      gaps.push("missing_auth_error_classification");
    }
    if (!hasAny([/rate.?limit|ratelimit|429|throttle|限流/])) {
      gaps.push("missing_rate_limit_handling");
    }

    // ── Timeout and retry ─────────────────────────────────────────────
    if (!hasAny([/timeout|deadline|max.?wait|超时/])) {
      gaps.push("missing_timeout_strategy");
    }
    if (hasAny([/retry|重试/]) && !hasAny([/backoff|exponential|jitter|退避/])) {
      gaps.push("missing_backoff_strategy");
      weakSignals.push("Backoff strategy (exponential + jitter)");
    }

    // ── Idempotency ───────────────────────────────────────────────────
    if (!hasAny([/idempotent|idempotency|幂等|exactly.?once|at.?most.?once/])) {
      gaps.push("missing_idempotency_analysis");
    }

    // ── Tests ─────────────────────────────────────────────────────────
    if (!hasAny([/test|测试|spec|\.test\./])) {
      gaps.push("missing_integration_tests");
    }

    // ── Baseline section coverage ─────────────────────────────────────
    for (const section of baseline.sections) {
      const sec = section.toLowerCase().replace(/\s/g, "");
      if (!context.includes(sec) && !context.includes(section.toLowerCase())) {
        missingSections.push(section);
        gaps.push(`missing_contract_section:${section}`);
      }
    }

    // ── Baseline signal coverage ──────────────────────────────────────
    for (const signal of baseline.signals) {
      const sig = signal.toLowerCase();
      if (!context.includes(sig) && !context.includes(sig.replace(/\s/g, ""))) {
        missingSignals.push(signal);
        gaps.push(`missing_contract_signal:${signal}`);
      }
    }

    // ── Weak signal detection ─────────────────────────────────────────
    if (hasAny([/schema|类型/]) && !hasAny([/required|optional|必填|可选/])) {
      weakSignals.push("Required/optional field annotation");
    }
    if (hasAny([/error|错误/]) && !hasAny([/user.?message|error.?message|错误消息/])) {
      weakSignals.push("User-readable error messages");
    }
    if (hasAny([/idempotent|idempotency|幂等/]) && !hasAny([/idempotency.?key|dedup|幂等.?键/])) {
      weakSignals.push("Idempotency key definition");
    }

    // ── Build baseline diffs ──────────────────────────────────────────
    const baselineDiffs: ESRPackBaselineDiff[] = [
      {
        baselineId: baseline.id,
        missingSections,
        missingSignals,
        weakSignals,
        suggestions: [
          ...missingSections.map((s) => `Add contract section: ${s}`),
          ...missingSignals.map((s) => `Add contract signal: ${s}`),
          ...weakSignals.map((s) => `Strengthen contract signal: ${s}`),
        ],
      },
    ];

    // ── Review findings ───────────────────────────────────────────────
    const reviewFindings: ESRPackReviewFinding[] = [
      ...missingSections.map((section) => ({
        id: `contract-section-${section.toLowerCase().replace(/\s/g, "-")}`,
        severity: "high" as const,
        category: "requirement" as const,
        title: `Missing contract section: ${section}`,
        summary: `Tool definition does not cover the required section "${section}".`,
        evidence: [baseline.label, section],
        recommendations: [`Add definition and documentation for "${section}".`],
      })),
      ...missingSignals.map((signal) => ({
        id: `contract-signal-${signal}`,
        severity: "medium" as const,
        category: "requirement" as const,
        title: `Missing contract signal: ${signal}`,
        summary: `Tool implementation does not address the required signal "${signal}".`,
        evidence: [baseline.label, signal],
        recommendations: [
          `Add "${signal}" handling logic in implementation or documentation.`,
        ],
      })),
      ...weakSignals.map((signal) => ({
        id: `weak-contract-${signal.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
        severity: "low" as const,
        category: "weak_signal" as const,
        title: `Weak contract signal: ${signal}`,
        summary: `The tool mentions relevant concepts but coverage of "${signal}" is insufficient.`,
        evidence: [baseline.label, signal],
        recommendations: [
          `Strengthen "${signal}" definition, implementation, or test coverage.`,
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
        ownerHint: finding.title.includes("section")
          ? "Tool Developer"
          : "Tool Developer + Reviewer",
        traceToBaseline: finding.evidence[0],
        acceptance: finding.title.includes("section")
          ? "Contract section added with clear type definitions and behavioral documentation."
          : finding.title.includes("Missing contract signal")
            ? "Signal addressed in implementation/docs and verifiable by tests."
            : "Signal strengthened with clear implementation logic and test coverage.",
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
          ? "Agent-tool validation passed: schema, error taxonomy, timeout, idempotency, and test signals are all present."
          : `Agent-tool validation gaps: ${gaps.join(", ")}`,
    };
  },
};
