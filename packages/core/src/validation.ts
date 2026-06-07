/**
 * pi-esr: Ontology Validation
 */

import type { EntityRole, EntityState, ArtifactType, SectionState, RelationType } from "./types.js";

export const VALID_ROLES = new Set<EntityRole>(["Actor", "Artifact", "Task", "Concept", "Constraint"]);

export const VALID_RELATIONS = new Set<RelationType>([
  "depends_on", "part_of", "implements",
  "supports", "contradicts", "refines",
  "evaluates", "scores", "validates",
  "triggers", "updates", "blocks", "produces",
]);

export const VALID_STATES = new Set<EntityState>(["active", "stable", "draft", "blocked", "deprecated"]);

export const VALID_SECTION_STATES = new Set<SectionState>(["draft", "editing", "stable", "invalid"]);

export const VALID_ARTIFACT_TYPES = new Set<ArtifactType>(["document", "code", "report", "spec"]);

export const VALID_TRANSITIONS: Record<EntityState, Set<EntityState>> = {
  draft: new Set(["active", "stable", "blocked", "deprecated"]),
  active: new Set(["stable", "blocked", "deprecated"]),
  stable: new Set(["active", "blocked", "deprecated"]),
  blocked: new Set(["active", "draft", "deprecated"]),
  deprecated: new Set(["draft"]),
};

export function validateRole(role: string): role is EntityRole {
  return VALID_ROLES.has(role as EntityRole);
}

export function validateRelationType(type: string): type is RelationType {
  return VALID_RELATIONS.has(type as RelationType);
}

export function validateState(state: string): state is EntityState {
  return VALID_STATES.has(state as EntityState);
}

export function validateSectionState(state: string): state is SectionState {
  return VALID_SECTION_STATES.has(state as SectionState);
}

export function validateArtifactType(type: string): type is ArtifactType {
  return VALID_ARTIFACT_TYPES.has(type as ArtifactType);
}

export function validateConfidence(c: number): boolean {
  return Number.isFinite(c) && c >= 0 && c <= 1;
}

export function canTransition(from: EntityState, to: EntityState): boolean {
  return VALID_TRANSITIONS[from]?.has(to) ?? false;
}
