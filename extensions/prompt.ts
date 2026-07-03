import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

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
 * Build the ESR system prompt.
 *
 * Includes:
 *   - Static methodology (ontology, golden rules, closure protocol)
 *   - Dynamic state snapshot (compact task+constraint summary) when `stateSummary` is provided
 *   - Auto-expand pack hint when provided
 *
 * The dynamic snapshot is kept compact (~200 tokens) to balance visibility
 * against prompt-cache churn. Use esr_get_context for full state mid-session.
 */
export function buildESRPrompt(stateSummary?: string, packHint?: string): string {
  const methodology = getPromptContent();
  const parts: string[] = [];

  if (methodology) {
    parts.push(methodology);
  }

  if (stateSummary) {
    parts.push("\n\n[ESR_SNAPSHOT]\n" + stateSummary);
  }

  if (packHint) {
    parts.push("\n\n" + packHint);
  }

  return "\n\n" + parts.join("\n");
}

/** @deprecated — use buildESRPrompt instead */
export function buildStaticPrompt(): string {
  return buildESRPrompt();
}
