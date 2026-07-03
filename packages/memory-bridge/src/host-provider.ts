/**
 * pi-esr: HostMemoryProvider — Bridge to external host memory systems.
 *
 * When the host runtime exposes memory tools (e.g. claude-mem, pi-memory),
 * ESR should not duplicate content. Instead, it attaches lightweight memory_ref
 * pointers to ESR entities, and delegates full-text operations to the host.
 *
 * This provider implements ESRMemoryProvider by delegating each operation to
 * a HostMemoryDelegate that the host runtime injects. If no delegate is wired
 * for a particular operation, the provider returns empty results — ESR's own
 * esr_mem_* tools become the fallback.
 */

import type { ESRMemoryProvider } from "./provider.js";
import type {
  ESRMemoryEntityQuery,
  ESRMemoryJournalEntry,
  ESRMemoryJournalQuery,
  ESRMemoryRecord,
  ESRMemoryRef,
  ESRMemorySearchInput,
  ESRMemoryStoreInput,
  ESRMemoryTimelineEntry,
} from "./types.js";

export interface HostMemoryDelegate {
  /** Store an observation in the host memory system. */
  store?: (input: ESRMemoryStoreInput) => Promise<ESRMemoryRef>;
  /** Search the host memory system. */
  search?: (input: ESRMemorySearchInput) => Promise<ESRMemoryRef[]>;
  /** List memory refs for a specific entity. */
  listByEntity?: (input: ESRMemoryEntityQuery) => Promise<ESRMemoryRef[]>;
  /** Get a chronological timeline for an entity. */
  timeline?: (input: ESRMemoryEntityQuery) => Promise<ESRMemoryTimelineEntry[]>;
  /** Count observations for an entity. */
  count?: (entityId?: string) => Promise<number>;
  /** Record a state transition in the host journal. */
  recordJournal?: (entityId: string, transition: string, metadata?: Record<string, unknown>) => Promise<void>;
  /** Query the host journal. */
  getJournal?: (input: ESRMemoryJournalQuery) => Promise<ESRMemoryJournalEntry[]>;
  /** Get all journal entries. */
  getAllJournal?: (limit?: number) => Promise<ESRMemoryJournalEntry[]>;
  /** Fetch full memory records from refs. */
  fetch?: (refs: ESRMemoryRef[]) => Promise<ESRMemoryRecord[]>;
  /** Render memory refs as a human-readable string for context injection. */
  render?: (refs: ESRMemoryRef[]) => Promise<string>;
}

/**
 * A memory provider that bridges to the host runtime's own memory system.
 *
 * Each operation delegates to the host if wired; otherwise returns a safe
 * empty result. This keeps ESR in "cooperate, don't compete" mode.
 */
export class HostMemoryProvider implements ESRMemoryProvider {
  readonly name: string;
  private readonly delegate: HostMemoryDelegate;

  constructor(name: string, delegate: HostMemoryDelegate) {
    this.name = name;
    this.delegate = delegate;
  }

  async isAvailable(): Promise<boolean> {
    return true; // Provider is available if the host wired a delegate
  }

  async store(input: ESRMemoryStoreInput): Promise<ESRMemoryRef> {
    if (this.delegate.store) return this.delegate.store(input);
    return fallbackRef(input.entityId);
  }

  async search(input: ESRMemorySearchInput): Promise<ESRMemoryRef[]> {
    if (this.delegate.search) return this.delegate.search(input);
    return [];
  }

  async listByEntity(input: ESRMemoryEntityQuery): Promise<ESRMemoryRef[]> {
    if (this.delegate.listByEntity) return this.delegate.listByEntity(input);
    return [];
  }

  async timeline(input: ESRMemoryEntityQuery): Promise<ESRMemoryTimelineEntry[]> {
    if (this.delegate.timeline) return this.delegate.timeline(input);
    return [];
  }

  async count(entityId?: string): Promise<number> {
    if (this.delegate.count) return this.delegate.count(entityId);
    return 0;
  }

  async recordJournal(entityId: string, transition: string, metadata?: Record<string, unknown>): Promise<void> {
    if (this.delegate.recordJournal) {
      await this.delegate.recordJournal(entityId, transition, metadata);
    }
  }

  async getJournal(input: ESRMemoryJournalQuery): Promise<ESRMemoryJournalEntry[]> {
    if (this.delegate.getJournal) return this.delegate.getJournal(input);
    return [];
  }

  async getAllJournal(limit?: number): Promise<ESRMemoryJournalEntry[]> {
    if (this.delegate.getAllJournal) return this.delegate.getAllJournal(limit);
    return [];
  }

  async fetch(refs: ESRMemoryRef[]): Promise<ESRMemoryRecord[]> {
    if (this.delegate.fetch) return this.delegate.fetch(refs);
    return refs.map(ref => ({
      ref,
      content: `[host memory: ${ref.provider}:${ref.ref_id}]`,
    }));
  }

  async render(refs: ESRMemoryRef[]): Promise<string> {
    if (this.delegate.render) return this.delegate.render(refs);
    if (refs.length === 0) return "";
    return `Host memory references (${refs.length}):\n${
      refs.map(r => `- [${r.provider}] ${r.title ?? r.ref_id} (${r.kind})`).join("\n")
    }`;
  }
}

function fallbackRef(entityId: string): ESRMemoryRef {
  const now = new Date().toISOString();
  return {
    ref_id: `host-${Date.now()}`,
    provider: "host",
    entity_id: entityId,
    kind: "note",
    created_at: now,
  };
}