/**
 * pi-esr: Core Types
 */

export type EntityRole = "Actor" | "Artifact" | "Task" | "Concept" | "Constraint";

export type RelationType =
  | "depends_on" | "part_of" | "implements"
  | "supports" | "contradicts" | "refines"
  | "evaluates" | "scores" | "validates"
  | "triggers" | "updates" | "blocks" | "produces";

export type EntityState = "active" | "stable" | "draft" | "blocked" | "deprecated";

export type ArtifactType = "document" | "code" | "report" | "spec";

export type SectionState = "draft" | "editing" | "stable" | "invalid";

export interface ESREntity {
  entity_id: string;
  role: EntityRole;
  state: EntityState;
  confidence: number;
  metrics: Record<string, number>;
  label?: string;
  updated_at: string;
}

export interface ESRRelation {
  from: string;
  to: string;
  type: RelationType;
}

export interface ESRArtifact {
  id: string;
  type: ArtifactType;
  version?: number;
  sections: ESRArtifactSection[];
}

export interface ESRArtifactSection {
  name: string;
  state: SectionState;
}

export interface ESRMemoryRefSummary {
  ref_id: string;
  provider: string;
  entity_id: string;
  kind: "summary" | "decision" | "incident" | "note";
  title?: string;
  created_at: string;
  metadata?: Record<string, unknown>;
}

export interface ESRPersistedState {
  version: number;
  entities: ESREntity[];
  relations: ESRRelation[];
  artifacts: ESRArtifact[];
  memory_refs: ESRMemoryRefSummary[];
}

export type Result<T = void> = { ok: true; value?: T } | { ok: false; error: string };
