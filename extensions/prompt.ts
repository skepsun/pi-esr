import { buildESRContext } from "./core/context";
import { ESRGraph } from "./core/graph";
import type { ESRRuntimeStateStore } from "./runtime/state";
import { buildRuntimeContext } from "./runtime/runtime";

export function buildPromptContext(graph: ESRGraph, runtimeStore?: ESRRuntimeStateStore): string {
  const esrContext = buildESRContext(graph);
  const runtimeContext = runtimeStore ? buildRuntimeContext(runtimeStore) : "";
  const fullContext = runtimeContext ? `${esrContext}\n\n${runtimeContext}` : esrContext;
  return `\n\n${fullContext}\n\nYou have access to ESR tools (esr_*). Use the ESR graph above to make structured, ontology-validated state transitions. For any meaningful work, create entities, link relations, and update states via the ESR tools. When you need multi-step execution, declare a DAG with esr_create_node, then call esr_run to execute it.`;
}
