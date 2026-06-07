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
  ArtifactType, SectionState,
  Result,
} from "./types.js";

// ── Core state machine ────────────────────────────────────
export { ESRGraph } from "./graph.js";
export { buildStableSnapshot, buildGraphFingerprint, buildESRContext } from "./context.js";

// ── Runtime engine ────────────────────────────────────────
export type {
  ExecutionNodeKind, ExecutionStatus, ExecutionNode,
  RuntimeEvent, RuntimeState, RuntimePersistedState,
  PlanResult, ExecutionResult, RuntimeTickResult,
} from "./runtime-types.js";
export { ESRRuntimeStateStore } from "./state.js";
export { computeRunnableNodes } from "./planner.js";
export { selectNextNode } from "./scheduler.js";
export { buildNodeCacheKey, InMemoryCacheStore } from "./cache.js";
export type { RuntimeCachePersistedState } from "./cache.js";
export { executeNode } from "./executor.js";
export type { ExecutorContext } from "./executor.js";
export { ESRRuntime, buildRuntimeContext } from "./runtime.js";
export { ToolDriverRegistry } from "./driver.js";
export type { ToolExecutionContext, ToolExecutionHandler } from "./driver.js";

// ── Session state ────────────────────────────────────────
export { getCurrentSessionId, setCurrentSessionId } from "./session.js";
export { MemoryStore } from "./store.js";
export type { Observation, JournalEntry } from "./store.js";
export {
  buildMemoryContext,
  buildActiveMemoryContext,
  formatObservation,
  formatJournalEntry,
} from "./recall.js";
export {
  recordStateChange,
  recordStateChanges,
  buildJournalSummary,
} from "./journal.js";
export type { StateChangeEvent } from "./journal.js";
