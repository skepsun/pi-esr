/**
 * pi-esr-memory: Recall — build entity-anchored memory context for LLM injection.
 *
 * Sorts by entity for deterministic output (prefix-cache compatible).
 */

import type { MemoryStore, Observation, JournalEntry } from "./store";

/**
 * Build a compact entity-anchored context block.
 *
 * Format:
 *   [ESR_MEMORY]
 *
 *   entity-1 (3 obs):
 *     2026-06-03: ...
 *     2026-06-04: ...
 *
 *   entity-2 (1 obs):
 *     2026-06-05: ...
 */
export function buildMemoryContext(
  store: MemoryStore,
  entityIds: string[],
  opts?: { maxObsPerEntity?: number; maxJournalPerEntity?: number },
): string {
  const maxObs = opts?.maxObsPerEntity ?? 5;
  const maxJournal = opts?.maxJournalPerEntity ?? 3;
  const lines: string[] = ["[ESR_MEMORY]", ""];

  const sorted = [...entityIds].sort();
  let hasContent = false;

  for (const eid of sorted) {
    const observations = store.recall(eid, maxObs);
    const journalEntries = store.getJournal(eid, maxJournal);

    if (observations.length === 0 && journalEntries.length === 0) continue;

    const obsCount = store.countFor(eid);
    const suffix = obsCount > maxObs ? ` (+${obsCount - maxObs} more)` : "";

    lines.push(`${eid} (${obsCount} obs${suffix}):`);

    // Show journal entries first (state transitions)
    for (const j of journalEntries) {
      const ts = j.created_at.slice(0, 16);
      lines.push(`  📍 ${ts}: ${j.transition}`);
    }

    // Then observations
    for (const o of observations) {
      const ts = o.created_at.slice(0, 16);
      const content = o.content.length > 200 ? o.content.slice(0, 197) + "..." : o.content;
      lines.push(`  ${ts}: ${content}`);
    }

    lines.push("");
    hasContent = true;
  }

  if (!hasContent) {
    lines.push("  (no memories)");
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Build memory context for entities that have recent observations only.
 * Filters out entities with no observations, returns the full context block.
 */
export function buildActiveMemoryContext(
  store: MemoryStore,
  entityIds: string[],
  opts?: { maxObsPerEntity?: number; maxJournalPerEntity?: number },
): string {
  // Keep only entities that have observations
  const active = entityIds.filter(id => store.countFor(id) > 0);
  if (active.length === 0) {
    return "[ESR_MEMORY]\n\n  (no memories)\n";
  }
  return buildMemoryContext(store, active, opts);
}

/**
 * Format a single observation as a log line.
 */
export function formatObservation(o: Observation): string {
  return `[${o.entity_id}] ${o.created_at.slice(0, 16)}: ${o.content}`;
}

/**
 * Format a journal entry as a log line.
 */
export function formatJournalEntry(j: JournalEntry): string {
  return `[${j.entity_id}] ${j.created_at.slice(0, 16)}: ${j.transition}`;
}
