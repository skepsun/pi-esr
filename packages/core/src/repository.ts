/**
 * pi-esr: Repository contracts for shared ESR state.
 */

import type {
  ESREntity,
  ESRRelation,
  ESRArtifact,
  ESRPersistedState,
} from "./types.js";

export interface VersionConflict {
  code: "version_conflict";
  entity_id: string;
  expected_version: number;
  current_version: number;
}

export interface ESREvent {
  revision: number;
  event_type: "entity_created" | "entity_updated";
  entity_type: "entity";
  entity_key: string;
  payload: Record<string, unknown>;
  actor_id?: string;
  session_id?: string;
  created_at: string;
}

export interface VersionedEntity extends ESREntity {
  version: number;
  updated_by?: string;
  session_id?: string;
}

export interface SaveEntityInput {
  entity: ESREntity;
  expected_version?: number;
  actor_id?: string;
  session_id?: string;
}

export type SaveResult<T> =
  | { ok: true; value: T; revision: number }
  | { ok: false; error: string; conflict?: VersionConflict };

export interface ESRRepository {
  loadGraph(): ESRPersistedState;
  getEntity(entityId: string): VersionedEntity | null;
  saveEntity(input: SaveEntityInput): SaveResult<VersionedEntity>;
  getCurrentRevision(): number;
  getChanges(sinceRevision: number, limit?: number): ESREvent[];
}

export type { ESREntity, ESRRelation, ESRArtifact, ESRPersistedState };
