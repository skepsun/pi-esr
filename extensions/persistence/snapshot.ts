import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { ESRGraph } from "../core/graph";

export function persistGraph(pi: ExtensionAPI, graph: ESRGraph): void {
  pi.appendEntry("esr-state", graph.toPersistedState());
}
