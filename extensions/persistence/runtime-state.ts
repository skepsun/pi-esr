import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { ESRRuntimeStateStore } from "@pi-esr/core";
import type { RuntimePersistedState } from "@pi-esr/core";

export const ESR_RUNTIME_STATE_ENTRY = "esr-runtime-state";

function isRuntimeState(data: unknown): data is RuntimePersistedState {
  if (!data || typeof data !== "object") return false;
  const d = data as Record<string, unknown>;
  return (
    typeof d.version === "number" &&
    Array.isArray(d.executionNodes) &&
    Array.isArray(d.events)
  );
}

export function persistRuntimeState(pi: ExtensionAPI, runtimeStore: ESRRuntimeStateStore): void {
  pi.appendEntry<RuntimePersistedState>(ESR_RUNTIME_STATE_ENTRY, runtimeStore.toPersistedState());
}

export function reconstructRuntimeState(ctx: ExtensionContext, runtimeStore: ESRRuntimeStateStore): void {
  runtimeStore.clear();
  for (const entry of ctx.sessionManager.getBranch()) {
    if (entry.type === "custom" && (entry as { customType?: string }).customType === ESR_RUNTIME_STATE_ENTRY) {
      const data = (entry as { data?: unknown }).data;
      if (isRuntimeState(data)) runtimeStore.loadFromState(data);
    }
  }
}
