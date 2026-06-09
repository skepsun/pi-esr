export type ESRMemoryRefKind =
  | "summary"
  | "decision"
  | "incident"
  | "note";

export interface ESRMemoryRef {
  ref_id: string;
  provider: string;
  entity_id: string;
  kind: ESRMemoryRefKind;
  title?: string;
  created_at: string;
  metadata?: Record<string, unknown>;
}

export interface ESRMemoryRecord {
  ref: ESRMemoryRef;
  content: string;
}

export interface ESRMemoryTimelineEntry {
  ref: ESRMemoryRef;
  content: string;
}

export interface ESRMemoryJournalEntry {
  entity_id: string;
  transition: string;
  created_at: string;
}

export interface ESRMemoryStoreInput {
  entityId: string;
  kind: ESRMemoryRefKind;
  content: string;
  title?: string;
  metadata?: Record<string, unknown>;
}

export interface ESRMemorySearchInput {
  query: string;
  entityId?: string;
  kinds?: ESRMemoryRefKind[];
  limit?: number;
}

export interface ESRMemoryEntityQuery {
  entityId: string;
  kinds?: ESRMemoryRefKind[];
  limit?: number;
}

export interface ESRMemoryJournalQuery {
  entityId: string;
  limit?: number;
}

export type MemoryCapabilityKind =
  | "rule"
  | "tool"
  | "store"
  | "auto_injected";

export type MemoryCapabilityStatus =
  | "available"
  | "likely"
  | "unknown"
  | "none";

export type MemoryEvidenceSource =
  | "file"
  | "tool"
  | "config"
  | "env"
  | "host_hint";

export interface MemoryEvidence {
  source: MemoryEvidenceSource;
  key: string;
  value: string;
  confidence: number;
  note?: string;
}

export interface MemoryCapabilityReport {
  status: MemoryCapabilityStatus;
  kinds: MemoryCapabilityKind[];
  providerHints: string[];
  confidence: number;
  evidence: MemoryEvidence[];
}

export interface DetectionToolInfo {
  name: string;
  description?: string;
}

export interface DetectionContext {
  cwd: string;
  tools?: DetectionToolInfo[];
  env?: Record<string, string | undefined>;
  packageJson?: {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  hostHints?: string[];
}
