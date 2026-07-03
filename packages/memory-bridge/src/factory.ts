import type { MemoryStore } from "../../core/src/store.js";
import { HostMemoryProvider } from "./host-provider.js";
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
  // Use a HostMemoryProvider that bridges to the external system — actual wire-up
  // is the host runtime's responsibility via HostMemoryDelegate.
  return withReason(new HostMemoryProvider(providerName, {
    // All delegate methods are optional — host wires what it supports.
    // Unwired methods return safe empty results per HostMemoryProvider defaults.
  }), `external_memory_detected:${providerName}`);
}

function withReason<T extends ESRMemoryProvider>(provider: T, reason: string): T {
  Object.defineProperty(provider, "__esrSelectionReason", {
    value: reason,
    enumerable: false,
    configurable: true,
  });
  return provider;
}
