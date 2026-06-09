import type { MemoryStore } from "../../core/src/store.js";
import { NullMemoryProvider } from "./null-provider.js";
import type { ESRMemoryProvider } from "./provider.js";
import { selectMemoryProvider } from "./select.js";
import { SqliteMemoryProvider } from "./sqlite-provider.js";
import type { MemoryCapabilityReport } from "./types.js";

export interface CreateMemoryProviderOptions {
  report: MemoryCapabilityReport;
  sqliteStore?: MemoryStore | null;
}

export function createMemoryProvider(options: CreateMemoryProviderOptions): ESRMemoryProvider {
  const providerName = selectMemoryProvider(options.report);

  if (providerName === "null") {
    return withReason(new NullMemoryProvider(), "no_memory_capability_detected");
  }

  if (providerName === "file-memory") {
    if (options.sqliteStore) {
      return withReason(new SqliteMemoryProvider(options.sqliteStore), "fallback_local_sqlite");
    }
    return withReason(new NullMemoryProvider(), "local_sqlite_unavailable");
  }

  // When an external memory system is detected, ESR should not compete with it.
  // Keep ESR in bridge-only mode until a concrete host provider is implemented.
  return withReason(new NullMemoryProvider(), `external_memory_detected:${providerName}`);
}

function withReason<T extends ESRMemoryProvider>(provider: T, reason: string): T {
  Object.defineProperty(provider, "__esrSelectionReason", {
    value: reason,
    enumerable: false,
    configurable: true,
  });
  return provider;
}
