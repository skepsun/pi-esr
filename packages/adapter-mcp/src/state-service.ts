import type { ESRPersistedState, Result } from "@pi-esr/core";
import { ESRGraph, SqliteESRRepository } from "@pi-esr/core";
import { persist } from "./persistence";

export class McpStateService {
  constructor(
    private readonly graph: ESRGraph,
    private readonly repository: SqliteESRRepository,
  ) {}

  commitGraphMutation(): Result {
    try {
      this.repository.syncFromGraph(this.graph.toPersistedState());
    } catch (error) {
      return { ok: false, error: formatError("sync repository", error) };
    }
    return this.mirrorSnapshot(this.graph.toPersistedState());
  }

  commitRepositoryMutation(): Result {
    let state: ESRPersistedState;
    try {
      state = this.repository.loadGraph();
    } catch (error) {
      return { ok: false, error: formatError("load repository", error) };
    }

    const loadResult = this.graph.loadFromState(state);
    if (!loadResult.ok) {
      return { ok: false, error: `repository state invalid: ${loadResult.error}` };
    }

    return this.mirrorSnapshot(state);
  }

  private mirrorSnapshot(state: ESRPersistedState): Result {
    const result = persist(state);
    if (!result.ok) {
      return { ok: false, error: `snapshot_mirror_failed: ${result.error}` };
    }
    return { ok: true };
  }
}

function formatError(action: string, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return `${action} failed: ${message}`;
}
