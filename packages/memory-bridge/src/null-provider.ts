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

export class NullMemoryProvider implements ESRMemoryProvider {
  readonly name = "null";

  async isAvailable(): Promise<boolean> {
    return false;
  }

  async store(_input: ESRMemoryStoreInput): Promise<ESRMemoryRef> {
    throw new Error("Memory provider not available");
  }

  async search(_input: ESRMemorySearchInput): Promise<ESRMemoryRef[]> {
    return [];
  }

  async listByEntity(_input: ESRMemoryEntityQuery): Promise<ESRMemoryRef[]> {
    return [];
  }

  async timeline(_input: ESRMemoryEntityQuery): Promise<ESRMemoryTimelineEntry[]> {
    return [];
  }

  async count(_entityId?: string): Promise<number> {
    return 0;
  }

  async recordJournal(_entityId: string, _transition: string, _metadata?: Record<string, unknown>): Promise<void> {
    throw new Error("Memory provider not available");
  }

  async getJournal(_input: ESRMemoryJournalQuery): Promise<ESRMemoryJournalEntry[]> {
    return [];
  }

  async getAllJournal(_limit?: number): Promise<ESRMemoryJournalEntry[]> {
    return [];
  }

  async fetch(_refs: ESRMemoryRef[]): Promise<ESRMemoryRecord[]> {
    return [];
  }

  async render(_refs: ESRMemoryRef[]): Promise<string> {
    return "";
  }
}
