import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ESRGraph } from "@pi-esr/core";
import type { ESRRuntimeStateStore } from "@pi-esr/core";

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

/**
 * Build the STATIC ESR methodology prompt for system-prompt injection.
 * Contains ontology, golden rules, closure protocol, and tool usage guidance.
 * Does NOT include dynamic state (entities, relations, tasks) — those are
 * fetched on-demand via the esr_get_context tool to preserve prompt-cache stability.
 */
export function buildStaticPrompt(): string {
  const promptContent = getPromptContent();
  return `\n\n${promptContent}\n\nYou have access to ESR tools (esr_*). Use the ESR ontology above to make structured, ontology-validated state transitions. For any meaningful work, create entities, link relations, and update states via the ESR tools. When you need multi-step execution, declare a DAG with esr_create_node, then call esr_run to execute it. Call esr_get_context to load the current graph state — it is NOT pre-injected.`;
}
