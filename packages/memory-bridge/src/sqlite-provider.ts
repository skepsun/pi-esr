import {
  buildJournalSummary,
} from "../../core/src/journal.js";
import {
  formatObservation,
} from "../../core/src/recall.js";
import {
  MemoryStore,
  type JournalEntry,
  type Observation,
} from "../../core/src/store.js";
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

export class SqliteMemoryProvider implements ESRMemoryProvider {
  readonly name = "sqlite-memory";

  constructor(private readonly backingStore: MemoryStore) {}

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async store(input: ESRMemoryStoreInput): Promise<ESRMemoryRef> {
    const rowId = this.storeImpl.store(input.entityId, input.content, {
      tags: buildTags(input),
      fingerprint: asFingerprint(input.metadata),
      sessionId: asSessionId(input.metadata),
    });
    const createdAt = new Date().toISOString();
    return {
      ref_id: String(rowId),
      provider: this.name,
      entity_id: input.entityId,
      kind: input.kind,
      title: input.title,
      created_at: createdAt,
      metadata: input.metadata,
    };
  }

  async search(input: ESRMemorySearchInput): Promise<ESRMemoryRef[]> {
    const limit = input.limit ?? 20;
    const results = input.entityId
      ? this.storeImpl
        .search(input.query, limit * 2)
        .filter((item) => item.entity_id === input.entityId)
        .slice(0, limit)
      : this.storeImpl.search(input.query, limit);
    return results.map((item) => observationToRef(item, this.name));
  }

  async listByEntity(input: ESRMemoryEntityQuery): Promise<ESRMemoryRef[]> {
    const limit = input.limit ?? 20;
    return this.storeImpl
      .recall(input.entityId, limit)
      .map((item) => observationToRef(item, this.name));
  }

  async timeline(input: ESRMemoryEntityQuery): Promise<ESRMemoryTimelineEntry[]> {
    const limit = input.limit ?? 50;
    return this.storeImpl.timeline(input.entityId, limit).map((item) => ({
      ref: observationToRef(item, this.name),
      content: item.content,
    }));
  }

  async count(entityId?: string): Promise<number> {
    return entityId ? this.storeImpl.countFor(entityId) : this.storeImpl.count();
  }

  async recordJournal(entityId: string, transition: string, metadata?: Record<string, unknown>): Promise<void> {
    this.storeImpl.journal(entityId, transition, asFingerprint(metadata));
  }

  async getJournal(input: ESRMemoryJournalQuery): Promise<ESRMemoryJournalEntry[]> {
    const limit = input.limit ?? 20;
    return this.storeImpl.getJournal(input.entityId, limit).map(journalToEntry);
  }

  async getAllJournal(limit = 100): Promise<ESRMemoryJournalEntry[]> {
    return this.storeImpl.getAllJournal(limit).map(journalToEntry);
  }

  async fetch(refs: ESRMemoryRef[]): Promise<ESRMemoryRecord[]> {
    if (refs.length === 0) return [];
    const grouped = new Map<string, Set<string>>();
    for (const ref of refs) {
      const ids = grouped.get(ref.entity_id) ?? new Set<string>();
      ids.add(ref.ref_id);
      grouped.set(ref.entity_id, ids);
    }

    const records: ESRMemoryRecord[] = [];
    for (const [entityId, ids] of grouped) {
      const observations = this.storeImpl.recall(entityId, Math.max(ids.size, 20));
      for (const item of observations) {
        if (!ids.has(String(item.id))) continue;
        records.push({
          ref: observationToRef(item, this.name),
          content: item.content,
        });
      }
    }
    return records;
  }

  async render(refs: ESRMemoryRef[]): Promise<string> {
    const records = await this.fetch(refs);
    if (records.length === 0) return "";
    return records.map((record) => formatObservation({
      ...refToObservation(record.ref, record.content),
    })).join("\n");
  }

  buildJournalSummary(entityIds: string[]): string {
    return buildJournalSummary(this.storeImpl, entityIds);
  }

  formatRecord(record: ESRMemoryRecord): string {
    return formatObservation(refToObservation(record.ref, record.content));
  }

  getStore(): MemoryStore {
    return this.backingStore;
  }

  private get storeImpl(): MemoryStore {
    return this.backingStore;
  }
}

function buildTags(input: ESRMemoryStoreInput): string[] {
  const tagSet = new Set<string>();
  if (Array.isArray(input.metadata?.tags)) {
    for (const tag of input.metadata.tags) {
      if (typeof tag === "string") tagSet.add(tag);
    }
  }
  tagSet.add(`kind:${input.kind}`);
  return [...tagSet];
}

function asFingerprint(metadata?: Record<string, unknown>): string | undefined {
  return typeof metadata?.fingerprint === "string" ? metadata.fingerprint : undefined;
}

function asSessionId(metadata?: Record<string, unknown>): string | undefined {
  return typeof metadata?.sessionId === "string" ? metadata.sessionId : undefined;
}

function observationToRef(item: Observation, provider: string): ESRMemoryRef {
  return {
    ref_id: String(item.id),
    provider,
    entity_id: item.entity_id,
    kind: inferKind(item.tags),
    created_at: item.created_at,
    metadata: {
      tags: item.tags,
      fingerprint: item.fingerprint,
      sessionId: item.session_id,
    },
  };
}

function refToObservation(ref: ESRMemoryRef, content: string): Observation {
  const metadata = ref.metadata ?? {};
  return {
    id: Number(ref.ref_id),
    entity_id: ref.entity_id,
    session_id: typeof metadata.sessionId === "string" ? metadata.sessionId : null,
    content,
    tags: Array.isArray(metadata.tags) ? metadata.tags.filter((tag): tag is string => typeof tag === "string") : [],
    fingerprint: typeof metadata.fingerprint === "string" ? metadata.fingerprint : null,
    created_at: ref.created_at,
  };
}

function inferKind(tags: string[]): ESRMemoryRef["kind"] {
  for (const tag of tags) {
    if (tag === "kind:summary") return "summary";
    if (tag === "kind:decision") return "decision";
    if (tag === "kind:incident") return "incident";
    if (tag === "kind:note") return "note";
  }
  return "note";
}

function journalToEntry(entry: JournalEntry): ESRMemoryJournalEntry {
  return {
    entity_id: entry.entity_id,
    transition: entry.transition,
    created_at: entry.created_at,
  };
}
