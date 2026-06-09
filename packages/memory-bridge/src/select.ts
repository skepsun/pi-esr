import type { MemoryCapabilityReport } from "./types.js";

export type MemoryProviderName =
  | "null"
  | "pi-memory"
  | "claude-mem"
  | "file-memory";

export function selectMemoryProvider(report: MemoryCapabilityReport): MemoryProviderName {
  if (report.providerHints.includes("pi-memory")) return "pi-memory";
  if (report.providerHints.includes("claude-mem")) return "claude-mem";
  if (report.status === "available" && report.kinds.includes("store")) {
    return "file-memory";
  }
  return "null";
}
