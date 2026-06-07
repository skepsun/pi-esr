import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { ESRGraph } from "@pi-esr/core";
import { loadGraphState } from "./graph-persist";

export async function reconstructGraph(ctx: ExtensionContext, graph: ESRGraph): Promise<void> {
  await loadGraphState(ctx, graph);
}
