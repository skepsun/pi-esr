/**
 * pi-esr-memory: Journal — auto-record ESR state transitions as memory.
 *
 * Listens to entity state changes and records them in the journal table,
 * optionally also as observations for the entity.
 */

import type { MemoryStore } from "./store.js";

export interface StateChangeEvent {
  entity_id: string;
  old_state: string;
  new_state: string;
  label?: string;
  fingerprint?: string;
}

/**
 * Record a state transition in both the journal and as an observation.
 */
export function recordStateChange(store: MemoryStore, event: StateChangeEvent): void {
  const transition = `${event.old_state} → ${event.new_state}`;

  // Journal entry (compact, structured)
  store.journal(event.entity_id, transition, event.fingerprint);

  // Also create a human-readable observation
  const label = event.label ? ` "${event.label}"` : "";
  const content = `State transition: ${transition}${label}`;
  store.store(event.entity_id, content, {
    tags: ["state-transition", `from:${event.old_state}`, `to:${event.new_state}`],
    fingerprint: event.fingerprint,
  });
}

/**
 * Record a batch of state changes at once (useful for journal snapshots).
 */
export function recordStateChanges(store: MemoryStore, events: StateChangeEvent[]): void {
  for (const e of events) {
    recordStateChange(store, e);
  }
}

/**
 * Build a journal summary for a set of entities.
 * Returns a compact text block suitable for context injection.
 */
export function buildJournalSummary(
  store: MemoryStore,
  entityIds: string[],
  opts?: { maxPerEntity?: number },
): string {
  const max = opts?.maxPerEntity ?? 3;
  const lines: string[] = [];

  const sorted = [...entityIds].sort();
  for (const eid of sorted) {
    const entries = store.getJournal(eid, max);
    if (entries.length === 0) continue;

    lines.push(`${eid}:`);
    for (const entry of entries) {
      const ts = entry.created_at.slice(0, 16);
      lines.push(`  ${ts} ${entry.transition}`);
    }
  }

  return lines.length > 0 ? lines.join("\n") : "(no journal entries)";
}
