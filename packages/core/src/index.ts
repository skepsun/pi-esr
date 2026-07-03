/**
 * pi-esr/core — Framework-agnostic ESR engine
 *
 * Zero external dependencies (better-sqlite3 optional).
 * Imports only from the Node.js standard library (crypto, fs, path, os).
 */

// ── Host interface ────────────────────────────────────────
export type { ESRHost } from "./host.js";

// ── Core types ────────────────────────────────────────────
export type {
  EntityRole, EntityState, RelationType,
  ESREntity, ESRRelation, ESRArtifact,
  ESRArtifactSection, ESRPersistedState,
  ESRMemoryRefSummary,
  ArtifactType, SectionState,
  ESREvaluationRecord,
  Result,
} from "./types.js";

// ── Core state machine ────────────────────────────────────
export { ESRGraph } from "./graph.js";
export { buildStableSnapshot, buildGraphFingerprint, buildESRContext } from "./context.js";
export { getClosureStatus, listClosureGaps, listTasks, loadClosurePolicy, resetClosurePolicy } from "./closure.js";
export type {
  ESRClosurePolicy,
  ESRClosureGapItem,
  ESRClosureStatus,
  ESRTaskListItem,
} from "./closure.js";
export { SqliteESRRepository } from "./repository-sqlite.js";

// ── Session state ────────────────────────────────────────
export { getCurrentSessionId, setCurrentSessionId } from "./session.js";
export type {
  ESRRepository,
  ESREvent,
  SaveEntityInput,
  SaveResult,
  VersionConflict,
  VersionedEntity,
} from "./repository.js";
