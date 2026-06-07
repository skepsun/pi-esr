import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { InMemoryCacheStore } from "@pi-esr/core";
import type { RuntimeCachePersistedState } from "@pi-esr/core";

export const ESR_RUNTIME_CACHE_ENTRY = "esr-runtime-cache";

function isRuntimeCacheState(data: unknown): data is RuntimeCachePersistedState {
  if (!data || typeof data !== "object") return false;
  const d = data as Record<string, unknown>;
  return Array.isArray(d.entries) && d.entries.every(
    (e: unknown) =>
      typeof e === "object" && e !== null &&
      typeof (e as Record<string, unknown>).key === "string" &&
      typeof (e as Record<string, unknown>).value === "object",
  );
}

export function persistRuntimeCache(pi: ExtensionAPI, cacheStore: InMemoryCacheStore): void {
  pi.appendEntry<RuntimeCachePersistedState>(ESR_RUNTIME_CACHE_ENTRY, cacheStore.toPersistedState());
}

export function reconstructRuntimeCache(ctx: ExtensionContext, cacheStore: InMemoryCacheStore): void {
  cacheStore.clear();
  for (const entry of ctx.sessionManager.getBranch()) {
    if (entry.type === "custom" && (entry as { customType?: string }).customType === ESR_RUNTIME_CACHE_ENTRY) {
      const data = (entry as { data?: unknown }).data;
      if (isRuntimeCacheState(data)) cacheStore.loadFromState(data);
    }
  }
}
