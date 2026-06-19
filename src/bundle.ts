/**
 * pi-esr bundle — single entrypoint that inlines all workspace packages
 * into one standalone file (no @pi-esr/* imports at runtime).
 *
 * Usage:
 *   esbuild src/bundle.ts --bundle --platform=node --format=esm \
 *     --outfile=dist/bundle.js --external:better-sqlite3
 *
 * Build:
 *   node scripts/bundle.mjs   (or npm run bundle)
 */

// ── Core engine ────────────────────────────────────────────
export {
  ESRGraph,
  buildESRContext,
  buildStableSnapshot,
  buildGraphFingerprint,
  getClosureStatus,
  listClosureGaps,
  listTasks,
  SqliteESRRepository,
  getCurrentSessionId,
  setCurrentSessionId,
} from "../packages/core/src/index.js";

export type {
  ESRHost,
  EntityRole,
  EntityState,
  RelationType,
  ESREntity,
  ESRRelation,
  ESRArtifact,
  ESRArtifactSection,
  ESRPersistedState,
  ESRMemoryRefSummary,
  ArtifactType,
  SectionState,
  Result,
  ESRClosurePolicy,
  ESRClosureGapItem,
  ESRClosureStatus,
  ESRTaskListItem,
  ESRRepository,
  ESREvent,
  SaveEntityInput,
  SaveResult,
  VersionConflict,
  VersionedEntity,
} from "../packages/core/src/index.js";

// ── Memory bridge ──────────────────────────────────────────
export {
  createMemoryProvider,
  detectMemoryCapabilities,
  selectMemoryProvider,
  NullMemoryProvider,
  SqliteMemoryProvider,
} from "../packages/memory-bridge/src/index.js";

export type {
  ESRMemoryProvider,
  ESRMemoryRef,
  ESRMemoryStoreInput,
  ESRMemorySearchInput,
  ESRMemoryEntityQuery,
  ESRMemoryRecord,
  ESRMemoryTimelineEntry,
  ESRMemoryJournalEntry,
  ESRMemoryJournalQuery,
  MemoryCapabilityReport,
  MemoryCapabilityStatus,
  MemoryCapabilityKind,
  MemoryEvidence,
  DetectionContext,
} from "../packages/memory-bridge/src/index.js";

// ── Domain packs ───────────────────────────────────────────
export {
  buildPackApplyPlan,
  createRegistry,
  detectBestPack,
} from "../packages/domain-pack/src/index.js";

// ── Core utilities ─────────────────────────────────────────
export { buildJournalSummary, recordStateChange } from "../packages/core/src/journal.js";
export { buildActiveMemoryContext, formatObservation } from "../packages/core/src/recall.js";
