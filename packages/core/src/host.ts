/**
 * pi-esr/core: ESRHost interface
 *
 * The ESRHost is the only integration surface between the framework-agnostic
 * core and any host environment (Pi, MCP CLI, OpenCode, standalone).
 *
 * Implementations supply:
 * - Persistence: how to save/load graph and runtime state
 * - Optional hook: called after every mutation (Pi uses this for auto-save)
 */

import type { ESRPersistedState } from "./types.js";
import type { RuntimePersistedState } from "./runtime-types.js";

export interface ESRHost {
  /** Persist the current graph state (entities, relations, artifacts). */
  persist(state: ESRPersistedState): void;

  /** Load the persisted graph state, or null if no prior state exists. */
  load(): ESRPersistedState | null;

  /** Persist runtime execution state (nodes, events, cache). */
  persistRuntime(state: RuntimePersistedState): void;

  /** Load persisted runtime state, or null if none. */
  loadRuntime(): RuntimePersistedState | null;

  /** Called after every mutation. Adapters can use this to flush to disk
   *  or invalidate caches. Optional — no-op if not provided. */
  onMutation?(): void;
}
