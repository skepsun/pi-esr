import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ESRGraph } from "@pi-esr/core";
import type { ESRRuntimeStateStore } from "@pi-esr/core";
import { buildESRContext } from "@pi-esr/core";
import { buildRuntimeContext } from "@pi-esr/core";

const __dirname = dirname(fileURLToPath(import.meta.url));

let _promptCache: string | null = null;

function getPromptContent(): string {
  if (_promptCache !== null) return _promptCache;
  try {
    _promptCache = readFileSync(join(__dirname, "..", "prompts", "esr.md"), "utf-8");
  } catch {
    _promptCache = "";
  }
  return _promptCache;
}

export function buildPromptContext(graph: ESRGraph, runtimeStore?: ESRRuntimeStateStore): string {
  const promptContent = getPromptContent();
  const esrContext = buildESRContext(graph);
  const runtimeContext = runtimeStore ? buildRuntimeContext(runtimeStore) : "";
  const fullContext = runtimeContext ? `${esrContext}\n\n${runtimeContext}` : esrContext;
  return `\n\n${promptContent}\n\n${fullContext}\n\nYou have access to ESR tools (esr_*). Use the ESR graph above to make structured, ontology-validated state transitions. For any meaningful work, create entities, link relations, and update states via the ESR tools. When you need multi-step execution, declare a DAG with esr_create_node, then call esr_run to execute it.`;
}
