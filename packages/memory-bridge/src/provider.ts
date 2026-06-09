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

export interface ESRMemoryProvider {
  readonly name: string;

  isAvailable(): Promise<boolean>;

  store(input: ESRMemoryStoreInput): Promise<ESRMemoryRef>;

  search(input: ESRMemorySearchInput): Promise<ESRMemoryRef[]>;

  listByEntity(input: ESRMemoryEntityQuery): Promise<ESRMemoryRef[]>;

  timeline(input: ESRMemoryEntityQuery): Promise<ESRMemoryTimelineEntry[]>;

  count(entityId?: string): Promise<number>;

  recordJournal(entityId: string, transition: string, metadata?: Record<string, unknown>): Promise<void>;

  getJournal(input: ESRMemoryJournalQuery): Promise<ESRMemoryJournalEntry[]>;

  getAllJournal(limit?: number): Promise<ESRMemoryJournalEntry[]>;

  fetch(refs: ESRMemoryRef[]): Promise<ESRMemoryRecord[]>;

  render(refs: ESRMemoryRef[]): Promise<string>;
}
