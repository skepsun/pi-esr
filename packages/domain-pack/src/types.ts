import type {
  ArtifactType,
  EntityRole,
  EntityState,
  RelationType,
  SectionState,
} from "@pi-esr/core";

export interface ESRPackDetectInput {
  prompt: string;
  cwd: string;
  host?: string;
}

export interface ESRPackExpandInput {
  goal: string;
  cwd: string;
}

export interface ESRPackValidateInput {
  context: string;
  cwd: string;
}

export interface ESRPackEntityDraft {
  entity_id: string;
  role: EntityRole;
  state?: EntityState;
  label?: string;
  confidence?: number;
  metrics?: Record<string, number>;
}

export interface ESRPackRelationDraft {
  from: string;
  to: string;
  type: RelationType;
}

export interface ESRPackArtifactDraft {
  id: string;
  type: ArtifactType;
  sections: Array<{
    name: string;
    state: SectionState;
  }>;
}

export interface ESRPackConstraintDraft {
  entity_id: string;
  description: string;
}

export interface ESRPackEvaluationDraft {
  entity_id: string;
  evaluator: string;
  confidence: number;
  metrics?: Record<string, number>;
}

export interface ESRPackMemoryRefDraft {
  entity_id: string;
  ref_id: string;
  provider: string;
  kind: "summary" | "decision" | "incident" | "note";
  title?: string;
  created_at?: string;
}

export interface ESRPackCheckDefinition {
  id: string;
  label: string;
  description: string;
}

export interface ESRPackReferenceBaseline {
  id: string;
  label: string;
  sourceType?: "planning" | "requirement";
  sections: string[];
  signals: string[];
}

export interface ESRPackBaselineDiff {
  baselineId: string;
  missingSections: string[];
  missingSignals: string[];
  weakSignals: string[];
  suggestions: string[];
}

export interface ESRPackReviewFinding {
  id: string;
  severity: "high" | "medium" | "low";
  category: "baseline_section" | "baseline_signal" | "weak_signal" | "audit_chain" | "requirement";
  title: string;
  summary: string;
  evidence: string[];
  recommendations: string[];
}

export interface ESRPackRemediationItem {
  id: string;
  findingId: string;
  priority: "high" | "medium" | "low";
  suggestedStatus: "open" | "in_progress" | "resolved";
  action: string;
  ownerHint: string;
  traceToBaseline?: string;
  acceptance: string;
}

export interface ESRPackExpansion {
  entities: ESRPackEntityDraft[];
  relations: ESRPackRelationDraft[];
  artifacts: ESRPackArtifactDraft[];
  constraints: ESRPackConstraintDraft[];
  checks?: ESRPackCheckDefinition[];
  referenceBaselines?: ESRPackReferenceBaseline[];
  summary?: string;
}

export interface ESRPackValidationResult {
  evaluations: ESRPackEvaluationDraft[];
  constraints: ESRPackConstraintDraft[];
  memoryRefs: ESRPackMemoryRefDraft[];
  gaps: string[];
  baselineDiffs?: ESRPackBaselineDiff[];
  reviewFindings?: ESRPackReviewFinding[];
  remediationItems?: ESRPackRemediationItem[];
  summary: string;
}

export interface ESRDomainPack {
  name: string;
  version: string;
  description?: string;
  detect(input: ESRPackDetectInput): Promise<number>;
  expand(input: ESRPackExpandInput): Promise<ESRPackExpansion>;
  validate(input: ESRPackValidateInput): Promise<ESRPackValidationResult>;
}
