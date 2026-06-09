import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { ESRGraph } from "../core";
import { persistGraphState } from "./graph-persist";

export function persistGraph(pi: ExtensionAPI, graph: ESRGraph): void {
  persistGraphState(pi, graph);
}
