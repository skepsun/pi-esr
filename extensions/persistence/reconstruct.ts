import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { ESRGraph } from "../core/graph";
import type { ESRPersistedState } from "../core/types";

function isPersistedState(data: unknown): data is ESRPersistedState {
  if (!data || typeof data !== "object") return false;
  const d = data as Record<string, unknown>;
  return (
    typeof d.version === "number" &&
    Array.isArray(d.entities) &&
    Array.isArray(d.relations) &&
    Array.isArray(d.artifacts)
  );
}

export function reconstructGraph(ctx: ExtensionContext, graph: ESRGraph): void {
  graph.clear();
  for (const entry of ctx.sessionManager.getBranch()) {
    if (entry.type === "custom" && (entry as { customType?: string }).customType === "esr-state") {
      const data = (entry as { data?: unknown }).data;
      if (isPersistedState(data)) graph.loadFromState(data);
    }
  }
}
